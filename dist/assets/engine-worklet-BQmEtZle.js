// AudioWorklet processor — runs in a separate thread.
// This file must be self-contained (no imports from src/).

interface WorkletParams {
  rpm: number;
  throttle: number;
  cylinders: number;
  engineType: string;
  spectralRolloff: number;
  firingHarmonicBoost: number;
  numHarmonics: number;
  boostBar: number;
  isShifting: boolean;
}

const DEFAULT_PARAMS: WorkletParams = {
  rpm: 800,
  throttle: 0,
  cylinders: 4,
  engineType: 'inline-4',
  spectralRolloff: 0.9,
  firingHarmonicBoost: 3.0,
  numHarmonics: 24,
  boostBar: 0,
  isShifting: false,
};

const MAX_HARMONICS = 32;
const SLOW_RANDOM_ALPHA = 0.0003;
const NOISE_AMP = 0.03;
const NOISE_FREQ = 0.002;

class EngineWorkletProcessor extends AudioWorkletProcessor {
  private phases: Float64Array;
  private slowRandom: Float64Array;
  private params: WorkletParams;
  // Smoothed params for glitch-free transitions
  private smoothRpm: number = 800;
  private smoothThrottle: number = 0;

  constructor() {
    super();
    this.phases = new Float64Array(MAX_HARMONICS);
    this.slowRandom = new Float64Array(MAX_HARMONICS);
    this.params = { ...DEFAULT_PARAMS };

    this.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'params') {
        this.params = e.data.params;
      }
    };
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
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
      isShifting,
    } = this.params;

    const sr = sampleRate;
    const harmonicCount = Math.min(numHarmonics, MAX_HARMONICS);
    const halfCyl = Math.max(1, Math.floor(cylinders / 2));

    for (let s = 0; s < output.length; s++) {
      // Smooth RPM and throttle to avoid clicks (per-sample interpolation)
      this.smoothRpm += (rpm - this.smoothRpm) * 0.001;
      this.smoothThrottle += (throttle - this.smoothThrottle) * 0.002;

      const currentRpm = this.smoothRpm;
      const currentThrottle = Math.max(0, this.smoothThrottle);
      const fCrank = currentRpm / 60;

      let sample = 0;

      for (let h = 1; h <= harmonicCount; h++) {
        // Base amplitude with spectral rolloff
        let amp = 1.0 / Math.pow(h, spectralRolloff);

        // Firing-order harmonic boost
        if (h % halfCyl === 0) {
          amp *= firingHarmonicBoost;
        }

        // Engine type-specific harmonic shaping
        if (engineType === 'v8-crossplane') {
          // Uneven firing creates strong odd harmonics (V8 rumble)
          if (h % 2 === 1) {
            amp *= 2.5;
          } else if (h % 4 !== 0) {
            amp *= 0.5;
          }
        } else if (engineType === 'v-twin') {
          // Strong low harmonics, uneven pulse (potato-potato)
          if (h <= 4) amp *= 3.0;
          if (h % 2 === 1) amp *= 1.8;
        } else if (engineType === 'v4') {
          // Distinctive 90-degree firing pattern
          if (h % 2 === 0) amp *= 2.0;
          if (h <= 6) amp *= 1.5;
        } else if (engineType === 'w16') {
          // Very smooth, many cylinders cancel vibrations
          if (h % 8 === 0) amp *= 2.5;
          amp *= 0.7;
        } else if (engineType === 'v12') {
          // Extremely smooth, strong 6th harmonic
          if (h % 6 === 0) amp *= 3.0;
          amp *= 0.8;
        } else if (engineType === 'flat-6') {
          // Boxer character, strong 3rd and even harmonics
          if (h % 3 === 0) amp *= 2.5;
          if (h % 2 === 0) amp *= 1.3;
        }

        // Diesel: more noise-like character, broader harmonics
        if (engineType === 'inline-4' && this.params.cylinders === 4) {
          if (spectralRolloff > 1.1 && h <= 6) {
            amp *= 1.5;
          }
        }

        // Throttle-dependent brightness
        const loadFactor =
          0.3 +
          0.7 *
            currentThrottle *
            Math.exp(-h * 0.02 * (1 - currentThrottle));
        amp *= loadFactor;

        // Micro-variation (slow random noise at ~5-20 Hz)
        this.updateSlowRandom(h);
        amp *= 1 + NOISE_AMP * this.slowRandom[h];

        // Phase accumulation with tiny frequency jitter
        const freqJitter = 1 + NOISE_FREQ * this.slowRandom[h];
        const fH = h * fCrank * freqJitter;
        this.phases[h] += fH / sr;
        if (this.phases[h] >= 1.0) this.phases[h] -= Math.floor(this.phases[h]);

        sample += amp * Math.sin(6.283185307179586 * this.phases[h]);
      }

      // Shift attenuation (torque cut sound)
      if (isShifting) {
        sample *= 0.3;
      }

      // Add subtle combustion noise proportional to throttle
      const noise = (Math.random() * 2 - 1) * currentThrottle * 0.02;
      sample += noise;

      // Normalize output
      output[s] = sample * 0.12;
    }

    return true;
  }

  private updateSlowRandom(index: number): void {
    const white = Math.random() * 2 - 1;
    this.slowRandom[index] +=
      SLOW_RANDOM_ALPHA * (white - this.slowRandom[index]);
  }
}

registerProcessor('engine-worklet', EngineWorkletProcessor);
