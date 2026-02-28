import type { SensorState } from './sensor-provider';

/**
 * Intermediate sensor fusion model.
 *
 * Addresses the gap between raw GPS/accelerometer and the EV loop:
 * - Complementary filter: trusts GPS for low-frequency, accelerometer for high-frequency
 * - Attitude quality: dynamic assessment of accelerometer orientation reliability
 * - Gas level estimation: infers throttle intent from acceleration context
 */

export interface SensorViewState {
  // Fused longitudinal acceleration (complementary filter output)
  fusedAccelMs2: number;
  fusedAccelG: number;
  // Separate GPS-only and accelerometer-only readings for comparison
  gpsAccelMs2: number;
  accelSensorMs2: number;
  // Attitude quality: 0 = unreliable, 1 = excellent
  attitudeQuality: number;
  attitudeDetails: {
    gravityMagError: number;   // deviation of gravity magnitude from 9.81
    gravityStability: number;  // 0-1, how stable the gravity vector is
    crossValidation: number;   // 0-1, agreement between GPS and accelerometer
  };
  // Estimated gas/throttle level: 0-1
  estimatedGasLevel: number;
  // Pass-through
  speedKmh: number;
  gpsAccuracyM: number;
  isGpsActive: boolean;
  hasAccelerometer: boolean;
}

const GRAVITY = 9.81;
// Complementary filter time constant (seconds)
// Below this frequency: trust GPS. Above: trust accelerometer.
const COMPLEMENTARY_TAU = 0.8;
// Gravity stability tracking window
const GRAVITY_HISTORY_SIZE = 60; // ~1 second at 60Hz
// Gas estimation parameters
const PEAK_ACCEL_FOR_GAS = 4.0; // m/s² = 100% gas (moderate acceleration)
const GAS_SMOOTHING_TAU = 0.3; // seconds

export class SensorAnalysis {
  // Complementary filter state
  private fusedAccel: number = 0;

  // Gravity vector history for stability tracking
  private gravityHistory: { x: number; y: number; z: number }[] = [];
  private gravityMagSmoothed: number = GRAVITY;

  // Cross-validation: running agreement between GPS and accel
  private crossValidationSmoothed: number = 1.0;

  // Gas level estimation
  private smoothedGasLevel: number = 0;

  // Previous accel for derivative-based detection
  private prevFusedAccel: number = 0;

  reset(): void {
    this.fusedAccel = 0;
    this.gravityHistory = [];
    this.gravityMagSmoothed = GRAVITY;
    this.crossValidationSmoothed = 1.0;
    this.smoothedGasLevel = 0;
    this.prevFusedAccel = 0;
  }

  update(sensor: SensorState, dt: number): SensorViewState {
    // --- 1. Complementary filter for acceleration ---
    // GPS accel: reliable direction & absolute, but low frequency (1-5 Hz)
    // Accel sensor: high frequency (60 Hz), but no direction, noisy
    const gpsAccel = sensor.gpsAccelerationMs2;
    const accelSensor = sensor.accelSmoothed;

    if (sensor.hasAccelerometer && dt > 0) {
      // Complementary filter: blend GPS (low-freq) + accelerometer (high-freq)
      // alpha → 0 for slow changes (trust GPS), alpha → 1 for fast changes (trust accel)
      const alpha = dt / (COMPLEMENTARY_TAU + dt);
      // GPS anchors the long-term value, accelerometer provides fast response
      this.fusedAccel = alpha * gpsAccel + (1 - alpha) * (this.fusedAccel + (accelSensor - this.prevFusedAccel));
      this.prevFusedAccel = accelSensor;
    } else {
      // No accelerometer — use GPS only
      this.fusedAccel = gpsAccel;
    }

    // --- 2. Attitude quality ---
    const attitudeDetails = this.computeAttitudeQuality(sensor, dt);

    // Combined quality score: weighted average of components
    const attitudeQuality = sensor.hasAccelerometer
      ? 0.3 * (1.0 - Math.min(1, attitudeDetails.gravityMagError / 2.0))
        + 0.35 * attitudeDetails.gravityStability
        + 0.35 * attitudeDetails.crossValidation
      : 0; // No accelerometer = no attitude

    // --- 3. Gas level estimation ---
    // Uses fused acceleration + speed context for more accurate estimation
    const rawGas = this.estimateGasLevel(this.fusedAccel, sensor.speedMs);
    const gasAlpha = Math.min(1, dt / GAS_SMOOTHING_TAU);
    this.smoothedGasLevel += (rawGas - this.smoothedGasLevel) * gasAlpha;

    return {
      fusedAccelMs2: this.fusedAccel,
      fusedAccelG: this.fusedAccel / GRAVITY,
      gpsAccelMs2: gpsAccel,
      accelSensorMs2: accelSensor,
      attitudeQuality: Math.max(0, Math.min(1, attitudeQuality)),
      attitudeDetails,
      estimatedGasLevel: Math.max(0, Math.min(1, this.smoothedGasLevel)),
      speedKmh: sensor.speedMs * 3.6,
      gpsAccuracyM: sensor.gpsAccuracy,
      isGpsActive: sensor.isGpsActive,
      hasAccelerometer: sensor.hasAccelerometer,
    };
  }

  private computeAttitudeQuality(
    sensor: SensorState,
    dt: number,
  ): SensorViewState['attitudeDetails'] {
    if (!sensor.hasAccelerometer) {
      return { gravityMagError: GRAVITY, gravityStability: 0, crossValidation: 0 };
    }

    // --- Gravity magnitude error ---
    // accelerationIncludingGravity should have magnitude ≈ 9.81 when stationary
    const gMag = Math.sqrt(
      sensor.gravityX * sensor.gravityX +
      sensor.gravityY * sensor.gravityY +
      sensor.gravityZ * sensor.gravityZ,
    );
    // Smooth the magnitude to avoid transient spikes
    const magAlpha = Math.min(1, dt * 5); // fast tracking
    this.gravityMagSmoothed += (gMag - this.gravityMagSmoothed) * magAlpha;
    const gravityMagError = Math.abs(this.gravityMagSmoothed - GRAVITY);

    // --- Gravity vector stability ---
    // Track how much the gravity vector wobbles over time
    this.gravityHistory.push({
      x: sensor.gravityX,
      y: sensor.gravityY,
      z: sensor.gravityZ,
    });
    if (this.gravityHistory.length > GRAVITY_HISTORY_SIZE) {
      this.gravityHistory.shift();
    }

    let gravityStability = 1.0;
    if (this.gravityHistory.length >= 10) {
      // Compute variance of gravity z-component (most sensitive to tilt changes)
      const zValues = this.gravityHistory.map((g) => g.z);
      const meanZ = zValues.reduce((a, b) => a + b, 0) / zValues.length;
      const variance = zValues.reduce((s, z) => s + (z - meanZ) * (z - meanZ), 0) / zValues.length;
      // Variance of 0 = perfectly stable, variance > 4 = very unstable
      gravityStability = Math.max(0, 1.0 - variance / 4.0);
    }

    // --- Cross-validation: GPS accel vs accelerometer ---
    // When both agree on direction and magnitude, quality is high
    const gpsA = sensor.gpsAccelerationMs2;
    const accelA = sensor.accelSmoothed;
    // Only meaningful when there's significant acceleration
    const significantAccel = Math.max(Math.abs(gpsA), Math.abs(accelA)) > 0.3;
    if (significantAccel) {
      // Normalized difference: 0 = perfect match, 1+ = disagreement
      const maxA = Math.max(Math.abs(gpsA), Math.abs(accelA), 0.5);
      const diff = Math.abs(gpsA - accelA) / maxA;
      const agreement = Math.max(0, 1.0 - diff);
      const cvAlpha = Math.min(1, dt * 2);
      this.crossValidationSmoothed += (agreement - this.crossValidationSmoothed) * cvAlpha;
    }
    // Decay slowly towards neutral when no significant acceleration
    else {
      const decayAlpha = Math.min(1, dt * 0.5);
      this.crossValidationSmoothed += (0.7 - this.crossValidationSmoothed) * decayAlpha;
    }

    return {
      gravityMagError,
      gravityStability,
      crossValidation: Math.max(0, Math.min(1, this.crossValidationSmoothed)),
    };
  }

  /**
   * Estimate gas level from acceleration and speed context.
   *
   * At low speed, even moderate acceleration means significant gas.
   * At high speed, the same acceleration requires much more power (aero drag).
   * Negative acceleration → 0 gas (braking/coasting).
   */
  private estimateGasLevel(accelMs2: number, speedMs: number): number {
    if (accelMs2 <= 0) return 0;

    // Speed-dependent scaling: at higher speeds, same accel = more gas
    // At 0 km/h: accel/4.0 maps to gas
    // At 100 km/h: same accel is effectively 1.5x gas
    const speedFactor = 1.0 + (speedMs / 28) * 0.5; // 28 m/s ≈ 100 km/h
    const effectiveAccel = accelMs2 * speedFactor;

    return Math.min(1, effectiveAccel / PEAK_ACCEL_FOR_GAS);
  }
}
