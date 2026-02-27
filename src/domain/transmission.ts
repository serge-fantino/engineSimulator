import type { EngineProfile, TransmissionMode } from './types';

const TWO_PI = 2 * Math.PI;
const MIN_SHIFT_DELAY_MS = 800;
const SHIFT_DURATION_MS = 120;

export class Transmission {
  private _gear: number = 0; // 0 = neutral
  private _isShifting: boolean = false;
  private shiftTimer: number = 0;
  private lastShiftTime: number = 0;
  private _mode: TransmissionMode = 'automatic';
  private profile: EngineProfile;
  private manualOverrideUntil: number = 0;
  private static MANUAL_OVERRIDE_DURATION_MS = 2500;

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  get gear(): number {
    return this._gear;
  }

  get isShifting(): boolean {
    return this._isShifting;
  }

  get maxGear(): number {
    return this.profile.gearRatios.length;
  }

  get mode(): TransmissionMode {
    return this._mode;
  }

  set mode(m: TransmissionMode) {
    this._mode = m;
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
    this._gear = 0; // start in neutral
    this._isShifting = false;
    this.manualOverrideUntil = 0;
  }

  speedToRPM(speedMs: number, gear: number): number {
    if (gear < 1 || gear > this.maxGear) return this.profile.idleRPM;
    const ratio = this.profile.gearRatios[gear - 1];
    return (
      (speedMs * ratio * this.profile.finalDrive * 60) /
      (TWO_PI * this.profile.wheelRadius)
    );
  }

  rpmToSpeed(rpm: number, gear: number): number {
    if (gear < 1 || gear > this.maxGear) return 0;
    const ratio = this.profile.gearRatios[gear - 1];
    return (
      (rpm * TWO_PI * this.profile.wheelRadius) /
      (ratio * this.profile.finalDrive * 60)
    );
  }

  update(dt: number): void {
    if (this._isShifting) {
      this.shiftTimer -= dt * 1000;
      if (this.shiftTimer <= 0) {
        this._isShifting = false;
      }
    }
  }

  checkAutoShift(rpm: number, throttle: number, now: number): void {
    if (this._mode !== 'automatic' || this._isShifting) return;
    if (this._gear === 0) return; // never auto-shift from neutral
    if (now < this.manualOverrideUntil) return; // respect manual override
    if (now - this.lastShiftTime < MIN_SHIFT_DELAY_MS) return;

    const upshiftRPM =
      this.profile.peakPowerRPM * (0.6 + 0.35 * throttle);
    const downshiftRPM =
      this.profile.peakTorqueRPM * (0.4 + 0.2 * throttle);

    if (rpm > upshiftRPM && this._gear < this.maxGear) {
      this.doShift(this._gear + 1, now);
    } else if (rpm < downshiftRPM && this._gear > 1) {
      this.doShift(this._gear - 1, now);
    }
  }

  shiftUp(now: number): void {
    if (this._isShifting || this._gear >= this.maxGear) return;
    if (now - this.lastShiftTime < MIN_SHIFT_DELAY_MS) return;
    this.doShift(this._gear + 1, now);
  }

  shiftDown(now: number, speedMs: number = 0): void {
    if (this._isShifting || this._gear <= 0) return; // can go down to neutral
    if (now - this.lastShiftTime < MIN_SHIFT_DELAY_MS) return;
    // Block shift to neutral if vehicle is moving (safety)
    if (this._gear === 1 && speedMs >= 1.0) return;
    this.doShift(this._gear - 1, now);
  }

  /** Manual override shift in auto mode — respects override timer */
  manualOverrideShift(direction: 'up' | 'down', now: number): void {
    if (this._isShifting) return;
    if (now - this.lastShiftTime < MIN_SHIFT_DELAY_MS) return;
    if (this._gear === 0) return; // use normal shiftUp to leave neutral

    const newGear = direction === 'up'
      ? Math.min(this._gear + 1, this.maxGear)
      : Math.max(this._gear - 1, 1); // don't shift to neutral via override

    if (newGear === this._gear) return;
    this.doShift(newGear, now);
    this.manualOverrideUntil = now + Transmission.MANUAL_OVERRIDE_DURATION_MS;
  }

  private doShift(newGear: number, now: number): void {
    this._isShifting = true;
    this.shiftTimer = SHIFT_DURATION_MS;
    this.lastShiftTime = now;
    this._gear = newGear;
  }

  reset(): void {
    this._gear = 0; // start in neutral
    this._isShifting = false;
    this.shiftTimer = 0;
    this.lastShiftTime = 0;
    this.manualOverrideUntil = 0;
  }
}
