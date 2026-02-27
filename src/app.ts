import type { EngineProfile, EngineState } from './domain/types';
import { getEngineTorque, computePower, clampRPM, applyRevLimiter } from './domain/engine-model';
import { Transmission } from './domain/transmission';
import { VehicleDynamics } from './domain/vehicle-dynamics';
import { TurboModel } from './domain/turbo-model';
import { AudioEngine } from './audio/audio-engine';
import { Dashboard } from './ui/dashboard';
import { Controls } from './ui/controls';
import { VehicleGallery } from './ui/vehicle-gallery';
import { getProfileGroups, getDefaultProfile } from './data/profile-loader';

export class App {
  private profile: EngineProfile;
  private transmission: Transmission;
  private vehicleDynamics: VehicleDynamics;
  private turboModel: TurboModel | null = null;
  private audioEngine: AudioEngine;
  private dashboard: Dashboard;
  private controls: Controls;
  private state: EngineState;
  private isRunning: boolean = false;
  private lastTimestamp: number = 0;
  private animFrameId: number = 0;
  private revLimiterPhase: number = 0;
  private startupBlipTimer: number = 0;
  private prevThrottle: number = 0;
  private launchControlActive: boolean = false;
  private launchPhaseTimer: number = 0; // countdown after LC release for maintained slip
  private gallery!: VehicleGallery;

  constructor() {
    this.profile = getDefaultProfile();
    this.transmission = new Transmission(this.profile);
    this.vehicleDynamics = new VehicleDynamics(this.profile);
    if (this.profile.turbo) {
      this.turboModel = new TurboModel(this.profile.turbo);
    }
    this.audioEngine = new AudioEngine();
    this.dashboard = new Dashboard(
      'tachometer-canvas',
      'gauges',
      this.profile,
    );
    this.controls = new Controls('controls-container');
    this.gallery = new VehicleGallery(
      'profile-selector-container',
      getProfileGroups(),
      this.profile,
      (p) => this.switchProfile(p),
    );
    this.state = this.createInitialState();

    // Wire volume control
    this.controls.onVolumeChange((vol) => this.audioEngine.setVolume(vol));

    // Wire power toggle
    this.controls.onPowerChange(async (on) => {
      if (on) {
        await this.engineOn();
      } else {
        this.engineOff();
      }
    });

    // Initial render (engine off state)
    this.dashboard.render(this.state);
    this.controls.updateGearDisplay(0, false);
  }

  /** Start engine — called from power toggle */
  private async engineOn(): Promise<void> {
    if (this.isRunning) return;
    await this.audioEngine.initialize(this.profile);
    this.audioEngine.start();
    await this.audioEngine.playStarterSound();

    // Reset to idle in neutral
    this.state = this.createInitialState();
    this.revLimiterPhase = 0;
    this.startupBlipTimer = 0.3; // 300ms rev blip
    this.launchControlActive = false;
    this.launchPhaseTimer = 0;

    this.isRunning = true;
    this.gallery.setCompact(true);
    this.lastTimestamp = performance.now();
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  /** Stop engine — called from power toggle */
  private engineOff(): void {
    this.isRunning = false;
    this.gallery.setCompact(false);
    cancelAnimationFrame(this.animFrameId);

    // Final render with RPM=0
    this.state = {
      ...this.state,
      rpm: 0,
      throttle: 0,
      gear: 0,
      speedMs: 0,
      speedKmh: 0,
      accelerationMs2: 0,
      accelerationG: 0,
      torqueNm: 0,
      powerKw: 0,
      powerHp: 0,
      boostBar: 0,
      revLimiterActive: false,
      wheelSlip: 0,
      launchControlActive: false,
    };
    this.dashboard.render(this.state);
    this.controls.updateGearDisplay(0, false);
    this.audioEngine.stop();
    this.vehicleDynamics.reset();
    this.transmission.reset();
  }

  private loop(timestamp: number): void {
    if (!this.isRunning) return;

    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);
    this.lastTimestamp = timestamp;

    // 1. Read controls
    const input = this.controls.update(dt);

    // Startup blip: override throttle briefly
    if (this.startupBlipTimer > 0) {
      this.startupBlipTimer -= dt;
      const blipFraction = Math.max(0, this.startupBlipTimer / 0.3);
      input.throttle = Math.max(input.throttle, 0.3 * blipFraction);
    }

    // 2. Update transmission timer
    this.transmission.update(dt);

    // 3. Handle shifts — auto mode allows manual override
    this.transmission.mode = input.transmissionMode;

    if (input.shiftUpPressed) {
      if (input.transmissionMode === 'automatic' && this.transmission.gear > 0) {
        // Manual override in auto mode
        this.transmission.manualOverrideShift('up', timestamp);
      } else {
        this.transmission.shiftUp(timestamp);
      }
    }
    if (input.shiftDownPressed) {
      if (input.transmissionMode === 'automatic' && this.transmission.gear > 0) {
        this.transmission.manualOverrideShift('down', timestamp);
      } else {
        this.transmission.shiftDown(timestamp, this.state.speedMs);
      }
    }

    // 3b. Launch control detection
    // Active when: in 1st gear, brake held, throttle high, nearly stationary
    const isLaunchCondition =
      this.transmission.gear === 1 &&
      input.brake > 0.5 &&
      input.throttle > 0.8 &&
      this.state.speedMs < 1.0;

    if (isLaunchCondition) {
      this.launchControlActive = true;
    } else if (this.launchControlActive) {
      if (input.brake < 0.1) {
        // Launch release — brake released → GO!
        this.launchControlActive = false;
        this.launchPhaseTimer = 1.5; // 1.5s of maintained clutch slip for aggressive launch
      } else if (input.throttle < 0.3) {
        // Throttle released — cancel launch
        this.launchControlActive = false;
        this.launchPhaseTimer = 0;
      }
    }

    // Countdown launch phase timer
    if (this.launchPhaseTimer > 0) {
      this.launchPhaseTimer = Math.max(0, this.launchPhaseTimer - dt);
    }

    // While LC active with brake held, force vehicle stationary (line-lock)
    if (this.launchControlActive && input.brake > 0.3) {
      this.vehicleDynamics.reset();
    }

    // ── 4. Clutch model ──────────────────────────────────────────
    // Simulates DCT / automatic clutch with progressive engagement.
    // Quadratic curve (slow at first, fast later) keeps engine RPM high longer,
    // like a real DCT that controls slip for optimal torque delivery.
    const CLUTCH_LOCK_SPEED = 12.0; // m/s (~43 km/h) — full lock-up threshold

    const speedMsPrev = this.state.speedMs;
    const gear = this.transmission.gear;
    const wheelRpmPrev = gear >= 1
      ? this.transmission.speedToRPM(speedMsPrev, gear)
      : this.profile.idleRPM;

    let clutchEngagement = 1.0; // 0 = fully slipping, 1 = locked
    let engineRPM: number;

    if (gear === 0) {
      // NEUTRAL — free-revving (RPM display handled later)
      engineRPM = this.state.rpm;
    } else if (this.launchControlActive) {
      // LAUNCH CONTROL — engine held at launch RPM, clutch disengaged
      engineRPM = this.state.rpm;
      clutchEngagement = 0;
    } else if (speedMsPrev < CLUTCH_LOCK_SPEED && gear >= 1) {
      // CLUTCH SLIPPING — quadratic engagement: slow rise → fast lockup
      // sqrt: 0.50 at 7km/h, 0.71 at 14km/h (too fast)
      // x²:   0.03 at 7km/h, 0.11 at 14km/h (gradual, realistic)
      const ratio = speedMsPrev / CLUTCH_LOCK_SPEED;
      clutchEngagement = Math.min(1, ratio * ratio);

      // Post-LC launch phase: reduce engagement to keep engine RPM high
      if (this.launchPhaseTimer > 0) {
        const launchFactor = 0.2 + 0.8 * (1 - this.launchPhaseTimer / 1.5);
        clutchEngagement *= launchFactor;
      }

      if (input.throttle < 0.05) {
        // No throttle → clutch disengaged, idle
        engineRPM = this.profile.idleRPM;
        clutchEngagement = 0;
      } else {
        // Throttle applied → ensure minimum engagement (clutch bite point)
        clutchEngagement = Math.max(0.35 * input.throttle, clutchEngagement);

        // Engine free-revs under load, RPM blended with wheel RPM
        const freeRevTarget = this.profile.idleRPM +
          input.throttle * (this.profile.redlineRPM - this.profile.idleRPM) * 0.85;
        engineRPM = freeRevTarget * (1 - clutchEngagement)
          + wheelRpmPrev * clutchEngagement;
        engineRPM = Math.max(engineRPM, this.profile.idleRPM);
      }
    } else {
      // FULLY LOCKED — engine RPM = wheel RPM
      engineRPM = Math.max(wheelRpmPrev, this.profile.idleRPM);
    }

    // 5. Compute engine torque at ENGINE RPM (not wheel RPM!)
    const torque = getEngineTorque(engineRPM, input.throttle, this.profile);

    // 6. Turbo update
    let boostBar = 0;
    let bovEnvelope = 0;
    if (this.turboModel) {
      const turboResult = this.turboModel.update(engineRPM, input.throttle, dt);
      boostBar = turboResult.boostBar;
      bovEnvelope = turboResult.bovEnvelope;
      if (turboResult.bovActive) {
        this.audioEngine.triggerBOV(bovEnvelope);
      }
    }

    // 6a. Apply turbo spool-up to torque
    // Torque curves represent peak (fully boosted) values.
    // At 0 boost → 65% (NA baseline), at max boost → 100%.
    let effectiveTorque: number;
    if (this.profile.turbo && this.turboModel) {
      const boostNorm = boostBar / this.profile.turbo.maxBoostBar;
      effectiveTorque = torque * (0.65 + 0.35 * boostNorm);
    } else {
      effectiveTorque = torque;
    }

    // 6b. Rev limiter
    const limiterResult = applyRevLimiter(
      engineRPM, this.profile, this.revLimiterPhase, dt,
    );
    this.revLimiterPhase = limiterResult.newPhase;
    effectiveTorque *= limiterResult.torqueMultiplier;
    if (limiterResult.popTriggered) {
      this.audioEngine.triggerRevLimiterPop();
    }

    // 6c. Engine torque for display (before clutch filtering)
    const displayTorque = effectiveTorque;

    // 6d. Clutch disengaged → no drive to wheels
    if (clutchEngagement === 0) {
      effectiveTorque = 0;
    }

    // 7. Vehicle dynamics
    const { speedMs, accelerationMs2, wheelSlip } = this.vehicleDynamics.update(
      dt,
      effectiveTorque,
      this.transmission.gear,
      input.brake,
      this.transmission.isShifting,
    );

    // 8. RPM display — mirrors clutch model with post-dynamics speed
    let rpm: number;
    const wheelRpm = this.transmission.speedToRPM(speedMs, this.transmission.gear);

    if (gear === 0) {
      // NEUTRAL: engine revs freely
      const targetRpm = input.throttle > 0.05
        ? this.profile.idleRPM +
          input.throttle * (this.profile.redlineRPM - this.profile.idleRPM) * 1.05
        : this.profile.idleRPM;

      // Rev limiter knock-back in neutral
      let effectiveTarget = targetRpm;
      if (this.state.rpm >= this.profile.redlineRPM - 100 && limiterResult.torqueMultiplier < 0.1) {
        effectiveTarget = Math.min(effectiveTarget, this.profile.redlineRPM - 200);
      }

      const tau = effectiveTarget > this.state.rpm ? 0.15 : 0.4;
      rpm = this.state.rpm + (effectiveTarget - this.state.rpm) * Math.min(1, dt / tau);
    } else if (this.launchControlActive) {
      // LAUNCH CONTROL: hold RPM high for turbo spool and optimal launch
      // Use ~70% of peak power RPM or 65% of redline, whichever is lower
      const launchRpm = Math.min(
        this.profile.peakPowerRPM * 0.7,
        this.profile.redlineRPM * 0.65,
      );
      const tau = 0.1;
      rpm = this.state.rpm + (launchRpm - this.state.rpm) * Math.min(1, dt / tau);
    } else if (clutchEngagement < 0.99 && gear >= 1 && input.throttle >= 0.05) {
      // CLUTCH SLIPPING: RPM display = same blend as torque RPM (quadratic curve)
      const ratio = speedMs / CLUTCH_LOCK_SPEED;
      let clutchNow = Math.min(1, ratio * ratio);
      // Post-LC launch phase: maintain lower engagement for higher RPM
      if (this.launchPhaseTimer > 0) {
        const launchFactor = 0.2 + 0.8 * (1 - this.launchPhaseTimer / 1.5);
        clutchNow *= launchFactor;
      }
      clutchNow = Math.max(0.35 * input.throttle, clutchNow);
      const freeRevTarget = this.profile.idleRPM +
        input.throttle * (this.profile.redlineRPM - this.profile.idleRPM) * 0.85;
      rpm = freeRevTarget * (1 - clutchNow) + wheelRpm * clutchNow;
      rpm = Math.max(rpm, this.profile.idleRPM);
    } else if (gear >= 1) {
      // FULLY LOCKED: RPM = wheel speed
      rpm = speedMs <= 0 ? this.profile.idleRPM : wheelRpm;
    } else {
      rpm = this.profile.idleRPM;
    }

    // Clamp: allow below idle when in gear (e.g. high gear, low speed)
    if (gear >= 1 && speedMs > 0 && clutchEngagement >= 0.99) {
      rpm = Math.max(0, Math.min(this.profile.redlineRPM, rpm));
    } else {
      rpm = clampRPM(rpm, this.profile);
    }

    // 11. Auto shift check
    if (input.transmissionMode === 'automatic') {
      this.transmission.checkAutoShift(rpm, input.throttle, timestamp);
    }

    // 12. Compute power (use displayTorque so LC shows engine output)
    const showTorque = this.launchControlActive ? displayTorque : effectiveTorque;
    const { kw, hp } = computePower(showTorque, rpm);

    // 13. Update state
    this.state = {
      rpm,
      throttle: input.throttle,
      brake: input.brake,
      gear: this.transmission.gear,
      speedMs,
      speedKmh: speedMs * 3.6,
      accelerationMs2,
      accelerationG: accelerationMs2 / 9.81,
      torqueNm: showTorque,
      powerKw: kw,
      powerHp: hp,
      boostBar,
      isShifting: this.transmission.isShifting,
      transmissionMode: input.transmissionMode,
      revLimiterActive: limiterResult.torqueMultiplier < 0.5,
      wheelSlip,
      launchControlActive: this.launchControlActive,
    };

    // 14. Update audio
    this.audioEngine.update(this.state);

    // 14b. Decel crackle detection (rapid throttle lift at high RPM)
    if (
      this.prevThrottle > 0.7 &&
      input.throttle < 0.2 &&
      rpm > this.profile.redlineRPM * 0.6
    ) {
      this.audioEngine.triggerDecelCrackle();
    }
    this.prevThrottle = input.throttle;

    // 14c. Tire squeal audio
    this.audioEngine.updateTireSqueal(wheelSlip);

    // 15. Update dashboard
    this.dashboard.render(this.state);

    // 16. Update controls gear display
    this.controls.updateGearDisplay(
      this.transmission.gear,
      this.transmission.isShifting,
    );

    // Next frame
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  private async switchProfile(profile: EngineProfile): Promise<void> {
    this.profile = profile;
    this.transmission = new Transmission(profile);
    this.vehicleDynamics = new VehicleDynamics(profile);
    this.turboModel = profile.turbo
      ? new TurboModel(profile.turbo)
      : null;
    this.vehicleDynamics.reset();
    this.revLimiterPhase = 0;
    this.launchControlActive = false;
    this.launchPhaseTimer = 0;
    this.dashboard.setProfile(profile);
    if (this.isRunning) {
      await this.audioEngine.switchProfile(profile);
    }
    this.state = this.createInitialState();
  }

  private createInitialState(): EngineState {
    return {
      rpm: this.isRunning ? this.profile.idleRPM : 0,
      throttle: 0,
      brake: 0,
      gear: 0, // always start in neutral
      speedMs: 0,
      speedKmh: 0,
      accelerationMs2: 0,
      accelerationG: 0,
      torqueNm: 0,
      powerKw: 0,
      powerHp: 0,
      boostBar: 0,
      isShifting: false,
      transmissionMode: 'automatic',
      revLimiterActive: false,
      wheelSlip: 0,
      launchControlActive: false,
    };
  }
}
