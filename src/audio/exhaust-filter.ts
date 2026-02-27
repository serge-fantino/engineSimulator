import type { ExhaustConfig } from '../domain/types';

export class ExhaustFilter {
  private lowpass: BiquadFilterNode;
  private peakingFilters: BiquadFilterNode[];
  private _input: AudioNode;
  private _output: AudioNode;

  get input(): AudioNode {
    return this._input;
  }

  get output(): AudioNode {
    return this._output;
  }

  constructor(ctx: AudioContext, config: ExhaustConfig) {
    // Lowpass for muffler simulation
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = config.lowpassBaseFreq;
    this.lowpass.Q.value = config.lowpassQ;

    // Chain of peaking EQ for exhaust resonances
    this.peakingFilters = config.resonances.map((res) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = res.freq;
      filter.Q.value = res.Q;
      filter.gain.value = res.gainDB;
      return filter;
    });

    // Wire: lowpass -> peaking1 -> peaking2 -> ...
    let prev: AudioNode = this.lowpass;
    for (const pf of this.peakingFilters) {
      prev.connect(pf);
      prev = pf;
    }

    this._input = this.lowpass;
    this._output =
      this.peakingFilters.length > 0
        ? this.peakingFilters[this.peakingFilters.length - 1]
        : this.lowpass;
  }

  update(rpm: number, config: ExhaustConfig): void {
    const cutoff = config.lowpassBaseFreq + rpm * config.lowpassRpmScale;
    this.lowpass.frequency.setTargetAtTime(cutoff, 0, 0.03);
  }

  disconnect(): void {
    this.lowpass.disconnect();
    for (const f of this.peakingFilters) f.disconnect();
  }
}
