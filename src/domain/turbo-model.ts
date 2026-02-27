import type { TurboConfig } from './types';

export interface TurboState {
  boostBar: number;
  bovActive: boolean;
  bovEnvelope: number;
}

export class TurboModel {
  private boostActual: number = 0;
  private bovTriggered: boolean = false;
  private bovTime: number = 0;
  private prevThrottle: number = 0;
  private config: TurboConfig;

  constructor(config: TurboConfig) {
    this.config = config;
  }

  setConfig(config: TurboConfig): void {
    this.config = config;
  }

  update(rpm: number, throttle: number, dt: number): TurboState {
    const c = this.config;

    // Target boost
    let boostTarget = 0;
    if (rpm >= c.boostThresholdRPM) {
      const rpmFactor = Math.min(
        1.0,
        (rpm - c.boostThresholdRPM) / 2000,
      );
      boostTarget = c.maxBoostBar * throttle * rpmFactor;
    }

    // Variable time constant (slower at low RPM)
    const tau =
      c.spoolTimeSec *
      (c.boostThresholdRPM / Math.max(rpm, c.boostThresholdRPM));
    const effectiveTau = Math.max(tau, 0.01);

    // First-order lag
    this.boostActual +=
      (boostTarget - this.boostActual) * (dt / effectiveTau);

    // BOV detection
    let bovEnvelope = 0;
    if (
      c.hasBOV &&
      throttle < 0.1 &&
      this.boostActual > 0.3 &&
      this.prevThrottle > 0.3
    ) {
      this.bovTriggered = true;
      this.bovTime = 0;
      this.boostActual *= 0.5;
    }

    if (this.bovTriggered) {
      this.bovTime += dt;
      bovEnvelope =
        this.bovTime < 0.01
          ? this.bovTime / 0.01
          : Math.exp(-(this.bovTime - 0.01) / 0.2);
      if (bovEnvelope < 0.01) {
        this.bovTriggered = false;
        bovEnvelope = 0;
      }
    }

    this.prevThrottle = throttle;
    return {
      boostBar: Math.max(0, this.boostActual),
      bovActive: this.bovTriggered,
      bovEnvelope,
    };
  }

  reset(): void {
    this.boostActual = 0;
    this.bovTriggered = false;
    this.bovTime = 0;
    this.prevThrottle = 0;
  }
}
