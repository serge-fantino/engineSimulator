export type SensorStatus =
  | { state: 'inactive' }
  | { state: 'requesting' }
  | { state: 'active'; accuracy: number }
  | { state: 'error'; reason: 'permission-denied' | 'unavailable' | 'timeout' | 'insecure-context' };

export interface SensorState {
  speedMs: number;
  accelerationMs2: number;
  gpsAccuracy: number;
  isGpsActive: boolean;
  // Extended raw data for sensor analysis
  rawAccelX: number;
  rawAccelY: number;
  rawAccelZ: number;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  hasAccelerometer: boolean;
  hasPureAccel: boolean; // true if acceleration (without gravity) is available
  gpsAccelerationMs2: number;
  accelSmoothed: number;
}

export type SensorStatusCallback = (status: SensorStatus) => void;

const ACCEL_SMOOTHING = 0.3; // low-pass filter alpha
const GPS_STALE_THRESHOLD_MS = 3000;

export class SensorProvider {
  private gpsWatchId: number | null = null;
  private lastGpsSpeed: number = 0;
  private lastGpsTimestamp: number = 0;
  private prevGpsSpeed: number = 0;
  private prevGpsTimestamp: number = 0;
  private gpsAcceleration: number = 0;
  private gpsAccuracy: number = Infinity;
  private interpolatedSpeed: number = 0;

  private accelSmoothed: number = 0;
  private hasAccelerometer: boolean = false;
  private deviceMotionHandler: ((e: DeviceMotionEvent) => void) | null = null;

  // Raw accelerometer data for sensor analysis
  private rawAccelX: number = 0;
  private rawAccelY: number = 0;
  private rawAccelZ: number = 0;
  private gravityX: number = 0;
  private gravityY: number = 0;
  private gravityZ: number = 0;
  private hasPureAccel: boolean = false;

  private statusCallback: SensorStatusCallback | null = null;
  private _isActive: boolean = false;

  get isActive(): boolean {
    return this._isActive;
  }

  onStatusChange(cb: SensorStatusCallback): void {
    this.statusCallback = cb;
  }

  async start(): Promise<SensorStatus> {
    // Check secure context
    if (!window.isSecureContext) {
      const status: SensorStatus = { state: 'error', reason: 'insecure-context' };
      this.statusCallback?.(status);
      return status;
    }

    // Check Geolocation API
    if (!navigator.geolocation) {
      const status: SensorStatus = { state: 'error', reason: 'unavailable' };
      this.statusCallback?.(status);
      return status;
    }

    this.statusCallback?.({ state: 'requesting' });

    // Request accelerometer permission (iOS)
    await this.requestAccelerometerPermission();

    // Start GPS
    return new Promise((resolve) => {
      this.gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
          this.handleGpsUpdate(position);
          if (!this._isActive) {
            this._isActive = true;
            const status: SensorStatus = {
              state: 'active',
              accuracy: position.coords.accuracy,
            };
            this.statusCallback?.(status);
            resolve(status);
          }
        },
        (error) => {
          if (!this._isActive) {
            const reason = error.code === 1 ? 'permission-denied'
              : error.code === 3 ? 'timeout'
              : 'unavailable';
            const status: SensorStatus = { state: 'error', reason };
            this.statusCallback?.(status);
            resolve(status);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000,
        },
      );

      // Start accelerometer listener
      this.startAccelerometer();
    });
  }

  stop(): void {
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
    }

    if (this.deviceMotionHandler) {
      window.removeEventListener('devicemotion', this.deviceMotionHandler);
      this.deviceMotionHandler = null;
    }

    this._isActive = false;
    this.interpolatedSpeed = 0;
    this.lastGpsSpeed = 0;
    this.accelSmoothed = 0;
    this.gpsAcceleration = 0;
    this.rawAccelX = 0;
    this.rawAccelY = 0;
    this.rawAccelZ = 0;
    this.gravityX = 0;
    this.gravityY = 0;
    this.gravityZ = 0;
    this.hasPureAccel = false;
    this.statusCallback?.({ state: 'inactive' });
  }

  update(dt: number): SensorState {
    const now = performance.now();
    const gpsStaleness = now - this.lastGpsTimestamp;

    if (gpsStaleness > GPS_STALE_THRESHOLD_MS && this.lastGpsTimestamp > 0) {
      // GPS stale — freeze speed, don't extrapolate
    } else if (this.hasAccelerometer && this.lastGpsTimestamp > 0) {
      // Interpolate between GPS updates using accelerometer
      this.interpolatedSpeed = Math.max(
        0,
        this.interpolatedSpeed + this.accelSmoothed * dt,
      );
    }

    return {
      speedMs: this.interpolatedSpeed,
      accelerationMs2: this.lastGpsTimestamp > 0 ? this.gpsAcceleration : 0,
      gpsAccuracy: this.gpsAccuracy,
      isGpsActive: this._isActive && gpsStaleness < GPS_STALE_THRESHOLD_MS,
      rawAccelX: this.rawAccelX,
      rawAccelY: this.rawAccelY,
      rawAccelZ: this.rawAccelZ,
      gravityX: this.gravityX,
      gravityY: this.gravityY,
      gravityZ: this.gravityZ,
      hasAccelerometer: this.hasAccelerometer,
      hasPureAccel: this.hasPureAccel,
      gpsAccelerationMs2: this.gpsAcceleration,
      accelSmoothed: this.accelSmoothed,
    };
  }

  private handleGpsUpdate(position: GeolocationPosition): void {
    const speed = position.coords.speed ?? 0;
    const now = performance.now();

    // Compute GPS-based acceleration
    this.prevGpsSpeed = this.lastGpsSpeed;
    this.prevGpsTimestamp = this.lastGpsTimestamp;

    if (this.prevGpsTimestamp > 0) {
      const dtGps = (now - this.prevGpsTimestamp) / 1000;
      if (dtGps > 0.01) {
        this.gpsAcceleration = (speed - this.prevGpsSpeed) / dtGps;
      }
    }

    this.lastGpsSpeed = speed;
    this.lastGpsTimestamp = now;
    this.gpsAccuracy = position.coords.accuracy;
    this.interpolatedSpeed = speed;

    // Update status with accuracy
    if (this._isActive) {
      this.statusCallback?.({
        state: 'active',
        accuracy: this.gpsAccuracy,
      });
    }
  }

  private async requestAccelerometerPermission(): Promise<void> {
    // iOS 13+ requires explicit permission for DeviceMotion
    const DME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DME.requestPermission === 'function') {
      try {
        const result = await DME.requestPermission();
        if (result !== 'granted') {
          // Accelerometer denied — GPS only mode, that's OK
          return;
        }
      } catch {
        return;
      }
    }
  }

  private startAccelerometer(): void {
    this.deviceMotionHandler = (event: DeviceMotionEvent) => {
      // Track whether we have pure acceleration (without gravity)
      const pureAccel = event.acceleration;
      const accelWithGravity = event.accelerationIncludingGravity;
      const accel = pureAccel || accelWithGravity;
      if (!accel) return;

      this.hasPureAccel = !!(pureAccel && pureAccel.x !== null);

      // Store raw values
      this.rawAccelX = accel.x ?? 0;
      this.rawAccelY = accel.y ?? 0;
      this.rawAccelZ = accel.z ?? 0;

      // Store gravity estimate from accelerationIncludingGravity
      if (accelWithGravity) {
        this.gravityX = accelWithGravity.x ?? 0;
        this.gravityY = accelWithGravity.y ?? 0;
        this.gravityZ = accelWithGravity.z ?? 0;
      }

      // Use total horizontal magnitude as proxy for longitudinal acceleration.
      // This is orientation-independent — works regardless of phone mounting.
      // We take x and y as the horizontal plane (z is vertical when phone is upright).
      const x = accel.x ?? 0;
      const y = accel.y ?? 0;
      const magnitude = Math.sqrt(x * x + y * y);

      // Sign from GPS acceleration (accelerometer magnitude doesn't tell direction)
      const signed = this.gpsAcceleration >= 0 ? magnitude : -magnitude;

      // Low-pass filter
      this.accelSmoothed =
        this.accelSmoothed * (1 - ACCEL_SMOOTHING) + signed * ACCEL_SMOOTHING;
      this.hasAccelerometer = true;
    };

    window.addEventListener('devicemotion', this.deviceMotionHandler);
  }
}
