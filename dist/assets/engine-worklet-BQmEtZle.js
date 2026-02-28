const DEFAULT_PARAMS = {
  rpm: 800,
  throttle: 0,
  cylinders: 4,
  engineType: "inline-4",
  spectralRolloff: 0.9,
  firingHarmonicBoost: 3,
  numHarmonics: 24,
  boostBar: 0,
  isShifting: false
};
const MAX_HARMONICS = 32;
const SLOW_RANDOM_ALPHA = 3e-4;
const NOISE_AMP = 0.03;
const NOISE_FREQ = 2e-3;
class EngineWorkletProcessor extends AudioWorkletProcessor {
  phases;
  slowRandom;
  params;
  // Smoothed params for glitch-free transitions
  smoothRpm = 800;
  smoothThrottle = 0;
  constructor() {
    super();
    this.phases = new Float64Array(MAX_HARMONICS);
    this.slowRandom = new Float64Array(MAX_HARMONICS);
    this.params = { ...DEFAULT_PARAMS };
    this.port.onmessage = (e) => {
      if (e.data.type === "params") {
        this.params = e.data.params;
      }
    };
  }
  process(_inputs, outputs, _parameters) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const {
      rpm,
      throttle,
      cylinders,
      engineType,
      spectralRolloff,
      firingHarmonicBoost,
      numHarmonics,
      isShifting
    } = this.params;
    const sr = sampleRate;
    const harmonicCount = Math.min(numHarmonics, MAX_HARMONICS);
    const halfCyl = Math.max(1, Math.floor(cylinders / 2));
    for (let s = 0; s < output.length; s++) {
      this.smoothRpm += (rpm - this.smoothRpm) * 1e-3;
      this.smoothThrottle += (throttle - this.smoothThrottle) * 2e-3;
      const currentRpm = this.smoothRpm;
      const currentThrottle = Math.max(0, this.smoothThrottle);
      const fCrank = currentRpm / 60;
      let sample = 0;
      for (let h = 1; h <= harmonicCount; h++) {
        let amp = 1 / Math.pow(h, spectralRolloff);
        if (h % halfCyl === 0) {
          amp *= firingHarmonicBoost;
        }
        if (engineType === "v8-crossplane") {
          if (h % 2 === 1) {
            amp *= 2.5;
          } else if (h % 4 !== 0) {
            amp *= 0.5;
          }
        } else if (engineType === "v-twin") {
          if (h <= 4) amp *= 3;
          if (h % 2 === 1) amp *= 1.8;
        } else if (engineType === "v4") {
          if (h % 2 === 0) amp *= 2;
          if (h <= 6) amp *= 1.5;
        } else if (engineType === "w16") {
          if (h % 8 === 0) amp *= 2.5;
          amp *= 0.7;
        } else if (engineType === "v12") {
          if (h % 6 === 0) amp *= 3;
          amp *= 0.8;
        } else if (engineType === "flat-6") {
          if (h % 3 === 0) amp *= 2.5;
          if (h % 2 === 0) amp *= 1.3;
        }
        if (engineType === "inline-4" && this.params.cylinders === 4) {
          if (spectralRolloff > 1.1 && h <= 6) {
            amp *= 1.5;
          }
        }
        const loadFactor = 0.3 + 0.7 * currentThrottle * Math.exp(-h * 0.02 * (1 - currentThrottle));
        amp *= loadFactor;
        this.updateSlowRandom(h);
        amp *= 1 + NOISE_AMP * this.slowRandom[h];
        const freqJitter = 1 + NOISE_FREQ * this.slowRandom[h];
        const fH = h * fCrank * freqJitter;
        this.phases[h] += fH / sr;
        if (this.phases[h] >= 1) this.phases[h] -= Math.floor(this.phases[h]);
        sample += amp * Math.sin(6.283185307179586 * this.phases[h]);
      }
      if (isShifting) {
        sample *= 0.3;
      }
      const noise = (Math.random() * 2 - 1) * currentThrottle * 0.02;
      sample += noise;
      output[s] = sample * 0.12;
    }
    return true;
  }
  updateSlowRandom(index) {
    const white = Math.random() * 2 - 1;
    this.slowRandom[index] += SLOW_RANDOM_ALPHA * (white - this.slowRandom[index]);
  }
}
registerProcessor("engine-worklet", EngineWorkletProcessor);
