import type { EngineProfile } from './types';

const AIR_DENSITY = 1.225;
const GRAVITY = 9.81;
const DRIVETRAIN_EFFICIENCY = 0.85;
const INERTIA_FACTORS = [0, 0.25, 0.15, 0.10, 0.08, 0.06, 0.05, 0.04, 0.035];

// Tire grip model
const MU_TIRE = 1.2; // Sport tire on dry road

function getDriveWheelFraction(profile: EngineProfile): number {
  const dt = profile.driveType || 'rwd';
  switch (dt) {
    case 'awd': return 0.95;   // Nearly all weight contributes to traction
    case 'fwd': return 0.55;   // Less weight on front axle under acceleration
    case 'rwd': return 0.50;   // Rear axle weight (~50% + weight transfer)
    default: return 0.50;
  }
}

export class VehicleDynamics {
  private _speedMs: number = 0;
  private _accelerationMs2: number = 0;
  private _wheelSlip: number = 0;
  private profile: EngineProfile;

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  get speedMs(): number {
    return this._speedMs;
  }

  get accelerationMs2(): number {
    return this._accelerationMs2;
  }

  get wheelSlip(): number {
    return this._wheelSlip;
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
  }

  update(
    dt: number,
    torqueNm: number,
    gear: number,
    brake: number,
    isShifting: boolean,
  ): { speedMs: number; accelerationMs2: number; wheelSlip: number } {
    const p = this.profile;

    // Traction force (zero during shift)
    let fTraction = 0;
    if (!isShifting && gear >= 1 && gear <= p.gearRatios.length) {
      const gearRatio = p.gearRatios[gear - 1];
      fTraction =
        (torqueNm * gearRatio * p.finalDrive * DRIVETRAIN_EFFICIENCY) /
        p.wheelRadius;
    }

    // Wheel slip / traction limit
    const driveWheelFraction = getDriveWheelFraction(p);
    const gripMax = MU_TIRE * p.vehicleMass * driveWheelFraction * GRAVITY;
    this._wheelSlip = 0;
    if (fTraction > gripMax && fTraction > 0) {
      this._wheelSlip = Math.min(1, (fTraction - gripMax) / gripMax);
      // Reduce traction when slipping (tires lose grip)
      fTraction = gripMax * (1 - 0.3 * this._wheelSlip);
    }

    // Brake force
    const brakeForceMax = p.vehicleMass * GRAVITY * 0.8;
    const fBrake = brake * brakeForceMax;

    // Aero drag
    const fDrag =
      0.5 *
      p.dragCoefficient *
      AIR_DENSITY *
      p.frontalArea *
      this._speedMs *
      this._speedMs;

    // Rolling resistance
    const fRolling = p.rollingResistance * p.vehicleMass * GRAVITY;

    // Net force
    const fNet = fTraction - fBrake - fDrag - fRolling;

    // Effective mass with rotational inertia
    const inertiaFactor = INERTIA_FACTORS[gear] ?? 0.05;
    const mEffective = p.vehicleMass * (1 + inertiaFactor);

    // Semi-implicit Euler integration
    this._accelerationMs2 = fNet / mEffective;
    this._speedMs = Math.max(0, this._speedMs + this._accelerationMs2 * dt);

    return {
      speedMs: this._speedMs,
      accelerationMs2: this._accelerationMs2,
      wheelSlip: this._wheelSlip,
    };
  }

  reset(): void {
    this._speedMs = 0;
    this._accelerationMs2 = 0;
    this._wheelSlip = 0;
  }
}
