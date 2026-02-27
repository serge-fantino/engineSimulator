import type { TurboConfig } from '../domain/types';

export class TurboAudio {
  private turboOsc: OscillatorNode;
  private turboOsc2: OscillatorNode;
  private turboGain: GainNode;
  private turboBandpass: BiquadFilterNode;
  private bovGain: GainNode;
  private bovBandpass: BiquadFilterNode;
  private mixerGain: GainNode;
  private ctx: AudioContext;
  private noiseBuffer: AudioBuffer;
  private activeBovSource: AudioBufferSourceNode | null = null;

  get output(): AudioNode {
    return this.mixerGain;
  }

  constructor(ctx: AudioContext, _config: TurboConfig) {
    this.ctx = ctx;

    // Turbo whistle: two oscillators for richer tone
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 2000;

    this.turboOsc2 = ctx.createOscillator();
    this.turboOsc2.type = 'sine';
    this.turboOsc2.frequency.value = 4000;

    this.turboBandpass = ctx.createBiquadFilter();
    this.turboBandpass.type = 'bandpass';
    this.turboBandpass.frequency.value = 3000;
    this.turboBandpass.Q.value = 4;

    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.3;

    this.turboOsc.connect(this.turboBandpass);
    this.turboOsc2.connect(osc2Gain);
    osc2Gain.connect(this.turboBandpass);
    this.turboBandpass.connect(this.turboGain);

    // BOV noise path
    this.bovBandpass = ctx.createBiquadFilter();
    this.bovBandpass.type = 'bandpass';
    this.bovBandpass.frequency.value = 1200;
    this.bovBandpass.Q.value = 3;

    this.bovGain = ctx.createGain();
    this.bovGain.gain.value = 0;

    this.bovBandpass.connect(this.bovGain);

    // Mixer
    this.mixerGain = ctx.createGain();
    this.mixerGain.gain.value = 1;
    this.turboGain.connect(this.mixerGain);
    this.bovGain.connect(this.mixerGain);

    // Create noise buffer for BOV
    this.noiseBuffer = this.createNoiseBuffer(0.5);

    this.turboOsc.start();
    this.turboOsc2.start();
  }

  update(boostBar: number, _rpm: number): void {
    const freq = 2000 + boostBar * 8000;
    const amp = boostBar * 0.12;
    this.turboOsc.frequency.setTargetAtTime(freq, 0, 0.05);
    this.turboOsc2.frequency.setTargetAtTime(freq * 2, 0, 0.05);
    this.turboGain.gain.setTargetAtTime(amp, 0, 0.03);
    this.turboBandpass.frequency.setTargetAtTime(freq, 0, 0.05);
  }

  triggerBOV(envelope: number): void {
    if (envelope > 0.01 && !this.activeBovSource) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.connect(this.bovBandpass);
      source.start();
      this.activeBovSource = source;
      source.onended = () => {
        this.activeBovSource = null;
      };
    }
    this.bovGain.gain.setTargetAtTime(envelope * 0.4, 0, 0.01);
  }

  disconnect(): void {
    this.turboOsc.stop();
    this.turboOsc2.stop();
    this.turboGain.disconnect();
    this.bovGain.disconnect();
    this.mixerGain.disconnect();
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
