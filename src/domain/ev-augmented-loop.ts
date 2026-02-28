import type { EngineProfile, EngineState, TransmissionMode } from './types';
import type { SensorState } from '../sensors/sensor-provider';
import { Transmission } from './transmission';
import { TurboModel } from './turbo-model';
import { getEngineTorque, computePower, clampRPM, applyRevLimiter } from './engine-model';

const THROTTLE_SMOOTHING_TAU = 0.15; // seconds
const PEAK_ACCEL_MS2 = 5.0; // ~0.5G — maps to full throttle
const PEAK_DECEL_MS2 = 8.0; // ~0.8G — maps to full brake

export class EvAugmentedLoop {
  private smoothedThrottle: number = 0;
  private smoothedBrake: number = 0;
  private revLimiterPhase: number = 0;
  private prevThrottle: number = 0;
  private turboModel: TurboModel | null = null;

  setTurbo(config: EngineProfile['turbo']): void {
    this.turboModel = config ? new TurboModel(config) : null;
  }

  update(
    sensorState: SensorState,
    profile: EngineProfile,
    transmission: Transmission,
    dt: number,
    timestamp: number,
    transmissionMode: TransmissionMode,
  ): { engineState: EngineState; decelCrackle: boolean; bovEnvelope: number } {
    const { speedMs, accelerationMs2 } = sensorState;

    // --- Throttle & brake from acceleration ---
    const rawThrottle = accelerationMs2 > 0
      ? Math.min(1, accelerationMs2 / PEAK_ACCEL_MS2)
      : 0;
    const rawBrake = accelerationMs2 < 0
      ? Math.min(1, -accelerationMs2 / PEAK_DECEL_MS2)
      : 0;

    // Idle throttle when stationary
    const targetThrottle = speedMs < 0.5 && rawThrottle < 0.05 ? 0.05 : rawThrottle;

    // Exponential smoothing
    const alpha = Math.min(1, dt / THROTTLE_SMOOTHING_TAU);
    this.smoothedThrottle += (targetThrottle - this.smoothedThrottle) * alpha;
    this.smoothedBrake += (rawBrake - this.smoothedBrake) * alpha;

    // --- Gear & RPM ---
    // Auto-engage 1st gear if moving and in neutral
    if (transmission.gear === 0 && speedMs > 0.5) {
      transmission.shiftUp(timestamp);
    }

    const gear = transmission.gear;
    let rpm = gear >= 1
      ? transmission.speedToRPM(speedMs, gear)
      : profile.idleRPM;

    // Clamp RPM
    if (gear >= 1 && speedMs > 0) {
      rpm = Math.max(profile.idleRPM, Math.min(profile.redlineRPM, rpm));
    } else {
      rpm = clampRPM(rpm, profile);
    }

    // Auto-shift (rétro agressif + kick-down)
    if (transmissionMode === 'automatic') {
      transmission.checkAutoShift(rpm, this.smoothedThrottle, speedMs, timestamp);
    }

    // --- Engine torque & power (for dashboard display) ---
    const torque = getEngineTorque(rpm, this.smoothedThrottle, profile);

    // --- Turbo ---
    let boostBar = 0;
    let bovEnvelope = 0;
    let effectiveTorque = torque;

    if (this.turboModel && profile.turbo) {
      const turboResult = this.turboModel.update(rpm, this.smoothedThrottle, dt);
      boostBar = turboResult.boostBar;
      bovEnvelope = turboResult.bovEnvelope;
      const boostNorm = boostBar / profile.turbo.maxBoostBar;
      effectiveTorque = torque * (0.65 + 0.35 * boostNorm);
    }

    // --- Rev limiter ---
    const limiterResult = applyRevLimiter(rpm, profile, this.revLimiterPhase, dt);
    this.revLimiterPhase = limiterResult.newPhase;
    effectiveTorque *= limiterResult.torqueMultiplier;

    // --- Power ---
    const { kw, hp } = computePower(effectiveTorque, rpm);

    // --- Decel crackle detection ---
    const decelCrackle =
      this.prevThrottle > 0.7 &&
      this.smoothedThrottle < 0.2 &&
      rpm > profile.redlineRPM * 0.6;
    this.prevThrottle = this.smoothedThrottle;

    const engineState: EngineState = {
      rpm,
      throttle: this.smoothedThrottle,
      brake: this.smoothedBrake,
      gear,
      speedMs,
      speedKmh: speedMs * 3.6,
      accelerationMs2,
      accelerationG: accelerationMs2 / 9.81,
      torqueNm: effectiveTorque,
      powerKw: kw,
      powerHp: hp,
      boostBar,
      isShifting: transmission.isShifting,
      transmissionMode,
      revLimiterActive: limiterResult.torqueMultiplier < 0.5,
      wheelSlip: 0,
      launchControlActive: false,
    };

    return { engineState, decelCrackle, bovEnvelope };
  }

  reset(): void {
    this.smoothedThrottle = 0;
    this.smoothedBrake = 0;
    this.revLimiterPhase = 0;
    this.prevThrottle = 0;
    if (this.turboModel) {
      this.turboModel = null;
    }
  }
}
