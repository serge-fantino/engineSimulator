import type { EngineProfile, EngineState } from '../domain/types';
import { ExhaustFilter } from './exhaust-filter';
import { TurboAudio } from './turbo-audio';

export interface AudioDebugInfo {
  contextState: string;
  sampleRate: number | null;
  workletLoaded: boolean;
  source: 'engine' | 'test' | 'none';
  canPlay: boolean;
}

export interface ToneOptions {
  /** Bass boost in dB (e.g. 0 to +9). Low shelf at ~120 Hz. */
  bassDb: number;
  /** Reverb amount 0 = dry, 1 = full wet. */
  reverbWet: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  /** One-off context created by "Test son" when engine is off; used for debug display. */
  private testContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private exhaustFilter: ExhaustFilter | null = null;
  private turboAudio: TurboAudio | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private profile: EngineProfile | null = null;
  private isRunning: boolean = false;
  private popNoiseBuffer: AudioBuffer | null = null;
  private activePopSource: AudioBufferSourceNode | null = null;
  /** Dedicated gain node for pops/bangs — bypasses compressor */
  private popGain: GainNode | null = null;
  /** Tone: bass shelf + reverb (dry/wet) */
  private bassShelf: BiquadFilterNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private toneDryGain: GainNode | null = null;
  private toneWetGain: GainNode | null = null;
  /** Decel crackle state */
  private _crackleActive: boolean = false;
  /** Tire squeal nodes (for launch control) */
  private squealSource: AudioBufferSourceNode | null = null;
  private squealGain: GainNode | null = null;
  private squealNoiseBuffer: AudioBuffer | null = null;

  async initialize(profile: EngineProfile): Promise<void> {
    this.profile = profile;
    if (this.testContext) {
      try { this.testContext.close(); } catch { /* ignore */ }
      this.testContext = null;
    }
    // Do not force sampleRate: mobile often uses 48000; forcing 44100 can mute audio
    this.ctx = new AudioContext({
      latencyHint: 'interactive',
    });

    // Load AudioWorklet module
    const workletUrl = new URL('./engine-worklet.ts', import.meta.url);
    await this.ctx.audioWorklet.addModule(workletUrl.href);

    this.buildGraph(profile);
  }

  private buildGraph(profile: EngineProfile): void {
    const ctx = this.ctx!;

    // Worklet node
    this.workletNode = new AudioWorkletNode(ctx, 'engine-worklet', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    // Exhaust filter chain
    this.exhaustFilter = new ExhaustFilter(ctx, profile.exhaustConfig);

    // Turbo audio (conditional)
    if (profile.turbo) {
      this.turboAudio = new TurboAudio(ctx, profile.turbo);
    }

    // Bass shelf (paramétrable) — son plus grave
    this.bassShelf = ctx.createBiquadFilter();
    this.bassShelf.type = 'lowshelf';
    this.bassShelf.frequency.value = 120;
    this.bassShelf.gain.value = 0;

    // Reverb: IR générée (salle courte) + dry/wet
    const irLength = Math.min(2 * ctx.sampleRate, 96000); // max ~2 s at 48k
    const irBuffer = ctx.createBuffer(1, irLength, ctx.sampleRate);
    const irData = irBuffer.getChannelData(0);
    const decaySec = 0.8;
    const decaySamples = decaySec * ctx.sampleRate;
    irData[0] = 1;
    for (let i = 1; i < irLength; i++) {
      irData[i] = (Math.random() * 2 - 1) * Math.exp(-i / decaySamples);
    }
    this.reverbConvolver = ctx.createConvolver();
    this.reverbConvolver.buffer = irBuffer;
    this.reverbConvolver.normalize = true;

    this.toneDryGain = ctx.createGain();
    this.toneDryGain.gain.value = 1;
    this.toneWetGain = ctx.createGain();
    this.toneWetGain.gain.value = 0;

    // Compressor (limiter) — for engine tone only
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -6;
    this.compressor.knee.value = 3;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.1;

    // Pop/bang gain — bypasses the compressor so transients are audible
    this.popGain = ctx.createGain();
    this.popGain.gain.value = 1.0;

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.7;

    // Route: worklet -> exhaust -> bassShelf -> [dry + reverb] -> compressor -> master
    this.workletNode.connect(this.exhaustFilter.input);
    this.exhaustFilter.output.connect(this.bassShelf!);
    this.bassShelf.connect(this.toneDryGain!);
    this.bassShelf.connect(this.reverbConvolver!);
    this.reverbConvolver.connect(this.toneWetGain!);
    this.toneDryGain.connect(this.compressor);
    this.toneWetGain.connect(this.compressor);

    if (this.turboAudio) {
      this.turboAudio.output.connect(this.compressor);
    }

    this.compressor.connect(this.masterGain);
    // Pop/bang route: pops -> popGain -> master (bypasses compressor)
    this.popGain.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Setup tire squeal (persistent noise source, gain at 0)
    this.setupTireSqueal();
  }

  /** Resume AudioContext (required on mobile/iOS — must be awaited after user gesture). */
  async start(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.isRunning = true;
  }

  stop(): void {
    this.isRunning = false;
    if (this.squealSource) {
      try { this.squealSource.stop(); } catch { /* ignore */ }
      this.squealSource = null;
    }
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend();
    }
  }

  update(state: EngineState): void {
    if (!this.workletNode || !this.profile || !this.isRunning) return;

    // Send params to worklet
    this.workletNode.port.postMessage({
      type: 'params',
      params: {
        rpm: state.rpm,
        throttle: state.throttle,
        cylinders: this.profile.cylinders,
        engineType: this.profile.type,
        spectralRolloff: this.profile.harmonicProfile.spectralRolloff,
        firingHarmonicBoost:
          this.profile.harmonicProfile.firingHarmonicBoost,
        numHarmonics: this.profile.harmonicProfile.numHarmonics,
        boostBar: state.boostBar,
        isShifting: state.isShifting,
      },
    });

    // Update exhaust filter
    this.exhaustFilter?.update(state.rpm, this.profile.exhaustConfig);

    // Update turbo audio
    if (this.turboAudio) {
      this.turboAudio.update(state.boostBar, state.rpm);
    }
  }

  triggerBOV(envelope: number): void {
    this.turboAudio?.triggerBOV(envelope);
  }

  /** Rev limiter pop — works for ALL engines, bypasses compressor */
  triggerRevLimiterPop(): void {
    if (!this.ctx || !this.popGain) return;
    const ctx = this.ctx;

    // Lazy-init noise buffer
    if (!this.popNoiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.15);
      this.popNoiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.popNoiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    // Anti-overlap
    if (this.activePopSource) return;

    const source = ctx.createBufferSource();
    source.buffer = this.popNoiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    // Randomize frequency for variation (600-1200 Hz)
    bp.frequency.value = 600 + Math.random() * 600;
    bp.Q.value = 4;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    // Randomize decay (50-100ms)
    const decayTime = 0.05 + Math.random() * 0.05;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.9, now + 0.005); // 5ms attack, louder gain
    gain.gain.exponentialRampToValueAtTime(0.01, now + decayTime);

    source.connect(bp);
    bp.connect(gain);
    gain.connect(this.popGain!); // bypass compressor!
    source.start(now);
    source.stop(now + 0.15);

    this.activePopSource = source;
    source.onended = () => { this.activePopSource = null; };
  }

  /** Deceleration crackle — burst of pops/bangs on overrun (plus audible). */
  triggerDecelCrackle(): void {
    if (!this.ctx || !this.popGain || this._crackleActive) return;
    const ctx = this.ctx;
    this._crackleActive = true;

    // Lazy-init noise buffer
    if (!this.popNoiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 0.15);
      this.popNoiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.popNoiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    // Série plus longue : 10–20 pops, espacement et gain aléatoires
    const numPops = 10 + Math.floor(Math.random() * 11);
    let timeOffset = 0;
    const now = ctx.currentTime;

    for (let i = 0; i < numPops; i++) {
      // Espacement aléatoire : parfois rafale (court), parfois pause (long)
      const baseDelay = 0.018 + Math.random() * 0.035;
      const burst = Math.random() < 0.35; // 35 % chance de pop très rapproché
      const delay = burst ? baseDelay * 0.5 : baseDelay;
      timeOffset += delay;

      const source = ctx.createBufferSource();
      source.buffer = this.popNoiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 180 + Math.random() * 550; // 180–730 Hz, un peu d’aléa
      bp.Q.value = 2 + Math.random() * 2;

      const gain = ctx.createGain();
      // Décroissance globale sur la série + aléa par pop (quelques pops plus forts)
      const decay = 1 - (i / numPops) * 0.6;
      const randomBoost = Math.random() < 0.25 ? 1.4 : 0.85 + Math.random() * 0.3;
      const popGainVal = Math.min(1.2, decay * randomBoost);
      const attack = 0.003 + Math.random() * 0.003;
      const decayTime = 0.04 + Math.random() * 0.04;
      const t = now + timeOffset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(Math.max(0.2, popGainVal), t + attack);
      gain.gain.exponentialRampToValueAtTime(0.01, t + decayTime);

      source.connect(bp);
      bp.connect(gain);
      gain.connect(this.popGain!);
      source.start(t);
      source.stop(t + Math.min(0.1, decayTime + 0.02));
    }

    setTimeout(() => { this._crackleActive = false; }, (timeOffset + 0.2) * 1000);
  }

  /** Tire squeal — persistent noise modulated by wheel slip */
  private setupTireSqueal(): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;

    // Create long noise buffer for squeal (2 seconds, loopable)
    const length = Math.floor(ctx.sampleRate * 2);
    this.squealNoiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.squealNoiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = this.squealNoiseBuffer;
    source.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000; // 2-4kHz band
    bp.Q.value = 3;

    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0; // silent by default

    source.connect(bp);
    bp.connect(this.squealGain);
    this.squealGain.connect(this.masterGain);
    source.start();
    this.squealSource = source;
  }

  /** Update tire squeal intensity based on wheel slip */
  updateTireSqueal(slip: number): void {
    if (!this.squealGain || !this.ctx) return;
    const targetGain = slip > 0.1 ? Math.min(0.5, slip * 0.8) : 0;
    this.squealGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.05);
  }

  /** Starter motor sound */
  async playStarterSound(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const duration = 0.5;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass sweep 100 -> 500 Hz (starter motor whine)
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(100, now);
    bp.frequency.linearRampToValueAtTime(500, now + 0.4);

    // Gain envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.setValueAtTime(0.3, now + 0.35);
    gain.gain.linearRampToValueAtTime(0, now + 0.45);

    source.connect(bp);
    bp.connect(gain);
    gain.connect(this.compressor || ctx.destination);
    source.start(now);
    source.stop(now + duration);

    return new Promise((resolve) => setTimeout(resolve, 500));
  }

  setVolume(volume: number): void {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, volume)),
        0,
        0.05,
      );
    }
  }

  /** Réglages son grave + reverb (paramétrables depuis l’UI). */
  setToneOptions(options: ToneOptions): void {
    if (this.bassShelf) {
      this.bassShelf.gain.value = Math.max(-6, Math.min(12, options.bassDb));
    }
    const wet = Math.max(0, Math.min(1, options.reverbWet));
    if (this.toneDryGain) this.toneDryGain.gain.setTargetAtTime(1 - wet, 0, 0.05);
    if (this.toneWetGain) this.toneWetGain.gain.setTargetAtTime(wet, 0, 0.05);
  }

  /** Debug info for the UI (context state, sample rate, etc.). */
  getDebugInfo(): AudioDebugInfo {
    const c = this.ctx ?? this.testContext;
    if (!c) {
      return {
        contextState: 'non initialisé',
        sampleRate: null,
        workletLoaded: false,
        source: 'none',
        canPlay: false,
      };
    }
    return {
      contextState: c.state,
      sampleRate: c.sampleRate,
      workletLoaded: this.workletNode != null,
      source: this.ctx ? 'engine' : 'test',
      canPlay: c.state === 'running',
    };
  }

  /**
   * Play a short horn sound to test audio. Works without engine: creates a temporary
   * context on first use (must be called from a user gesture on mobile).
   * Uses AudioBuffer instead of OscillatorNode for better reliability on iOS/Android.
   */
  async playHorn(): Promise<void> {
    const ctx = this.ctx ?? this.testContext;
    if (ctx) {
      if (ctx.state === 'suspended') await ctx.resume();
      this.scheduleHorn(ctx);
      return;
    }
    this.testContext = new AudioContext();
    const testCtx = this.testContext;
    if (testCtx.state === 'suspended') {
      await testCtx.resume();
    }
    // Small delay so mobile commits the context before first buffer (iOS/Android quirk)
    setTimeout(() => this.scheduleHorn(testCtx), 50);
  }

  /**
   * Horn as pre-rendered buffer (more reliable than OscillatorNode on mobile).
   * Schedules with a tiny delay from "now" so the graph is committed.
   */
  private scheduleHorn(ctx: AudioContext): void {
    const duration = 0.5;
    const sr = ctx.sampleRate;
    const numSamples = Math.floor(sr * duration);
    const buffer = ctx.createBuffer(1, numSamples, sr);
    const data = buffer.getChannelData(0);
    const f1 = 440;
    const f2 = 554;
    for (let i = 0; i < numSamples; i++) {
      const t = i / sr;
      const env = t < 0.02 ? t / 0.02 : t > duration - 0.05 ? (duration - t) / 0.05 : 1;
      data[i] = env * 0.35 * (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t));
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = now + 0.02; // let mobile commit the graph
    source.start(startAt);
    source.stop(startAt + duration);
  }

  async switchProfile(profile: EngineProfile): Promise<void> {
    if (!this.ctx) return;

    // Fade out
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
    await new Promise((r) => setTimeout(r, 300));

    // Stop squeal
    if (this.squealSource) {
      try { this.squealSource.stop(); } catch { /* ignore */ }
      this.squealSource = null;
    }

    // Disconnect old graph
    this.workletNode?.disconnect();
    this.exhaustFilter?.disconnect();
    this.bassShelf?.disconnect();
    this.reverbConvolver?.disconnect();
    this.toneDryGain?.disconnect();
    this.toneWetGain?.disconnect();
    this.turboAudio?.disconnect();
    this.compressor?.disconnect();
    this.popGain?.disconnect();
    this.masterGain?.disconnect();
    this.turboAudio = null;

    // Build new graph
    this.profile = profile;
    this.buildGraph(profile);

    // Fade in
    if (this.masterGain) {
      this.masterGain.gain.value = 0;
      this.masterGain.gain.setTargetAtTime(0.7, this.ctx.currentTime, 0.15);
    }
  }
}
