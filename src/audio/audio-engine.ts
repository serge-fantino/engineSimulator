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

    // Route: worklet -> exhaust -> compressor -> master -> output
    this.workletNode.connect(this.exhaustFilter.input);
    this.exhaustFilter.output.connect(this.compressor);

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

  /** Deceleration crackle — burst of micro-pops on overrun */
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

    // 3-7 micro-pops
    const numPops = 3 + Math.floor(Math.random() * 5);
    let timeOffset = 0;
    const now = ctx.currentTime;

    for (let i = 0; i < numPops; i++) {
      const delay = 0.03 + Math.random() * 0.05; // 30-80ms spacing
      timeOffset += delay;

      const source = ctx.createBufferSource();
      source.buffer = this.popNoiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600 + Math.random() * 900; // 600-1500 Hz
      bp.Q.value = 3 + Math.random() * 2;

      const gain = ctx.createGain();
      // Decreasing gain for each pop
      const popGainVal = (0.6 - i * 0.06) * (0.5 + Math.random() * 0.5);
      const t = now + timeOffset;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(Math.max(0.1, popGainVal), t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.04);

      source.connect(bp);
      bp.connect(gain);
      gain.connect(this.popGain!);
      source.start(t);
      source.stop(t + 0.06);
    }

    // Reset crackle flag after all pops are done
    setTimeout(() => { this._crackleActive = false; }, (timeOffset + 0.1) * 1000);
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
   */
  async playHorn(): Promise<void> {
    const ctx = this.ctx ?? this.testContext;
    if (ctx) {
      await this.playHornWithContext(ctx);
      return;
    }
    this.testContext = new AudioContext();
    const testCtx = this.testContext;
    if (testCtx.state === 'suspended') {
      await testCtx.resume();
    }
    await this.playHornWithContext(testCtx);
  }

  private playHornWithContext(ctx: AudioContext): void {
    const now = ctx.currentTime;
    const duration = 0.4;
    const f1 = 440;
    const f2 = 554;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = f1;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = f2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain.gain.setValueAtTime(0.2, now + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
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
