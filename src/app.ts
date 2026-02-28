import type { EngineProfile, EngineState, InputMode } from './domain/types';
import { getEngineTorque, computePower, clampRPM, applyRevLimiter } from './domain/engine-model';
import { Transmission } from './domain/transmission';
import { VehicleDynamics } from './domain/vehicle-dynamics';
import { TurboModel } from './domain/turbo-model';
import { AudioEngine } from './audio/audio-engine';
import { Dashboard } from './ui/dashboard';
import { Controls } from './ui/controls';
import { VehicleGallery } from './ui/vehicle-gallery';
import { getProfileGroups, getDefaultProfile } from './data/profile-loader';
import { SensorProvider } from './sensors/sensor-provider';
import { EvAugmentedLoop } from './domain/ev-augmented-loop';

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
  private sensorProvider: SensorProvider;
  private evLoop: EvAugmentedLoop;
  private inputMode: InputMode = 'keyboard';

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
    this.sensorProvider = new SensorProvider();
    this.evLoop = new EvAugmentedLoop();
    this.state = this.createInitialState();

    // Wire volume control
    this.controls.onVolumeChange((vol) => this.audioEngine.setVolume(vol));

    // Wire EV mode toggle
    this.controls.onInputModeChange((mode) => this.switchInputMode(mode));
    this.sensorProvider.onStatusChange((status) => this.controls.setEvStatus(status));

    // Wire power toggle (sync callback to avoid minifier/await strict-mode issues on deploy)
    this.controls.onPowerChange((on) => {
      if (on) {
        this.engineOn().catch((err) => console.error('Engine start failed', err));
      } else {
        this.engineOff();
      }
    });

    this.controls.setHornClick(() => this.audioEngine.playHorn());
    this.controls.setAudioDebugGetter(() => this.audioEngine.getDebugInfo());

    // Initial render (engine off state)
    this.dashboard.render(this.state);
    this.controls.updateGearDisplay(0, false);
  }

  /** Start engine — called from power toggle (must run in user gesture for mobile sound). */
  private async engineOn(): Promise<void> {
    if (this.isRunning) return;
    await this.audioEngine.initialize(this.profile);
    await this.audioEngine.start(); // await resume() so context is running before any sound
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

    // Stop sensors if EV mode was active
    if (this.inputMode === 'ev-augmented') {
      this.sensorProvider.stop();
      this.inputMode = 'keyboard';
      this.controls.revertToKeyboard();
    }
  }

  private async switchInputMode(mode: InputMode): Promise<void> {
    if (mode === this.inputMode) return;

    if (mode === 'ev-augmented') {
      const status = await this.sensorProvider.start();
      if (status.state === 'error') {
        this.controls.revertToKeyboard();
        return;
      }
      this.inputMode = 'ev-augmented';
      this.evLoop.reset();
      this.evLoop.setTurbo(this.profile.turbo);

      // Auto-start engine if not running
      if (!this.isRunning) {
        this.controls.simulatePowerOn();
      }

      // Auto-engage 1st gear if in neutral
      if (this.transmission.gear === 0) {
        this.transmission.shiftUp(performance.now());
      }
    } else {
      this.sensorProvider.stop();
      this.inputMode = 'keyboard';
    }
  }

  private loop(timestamp: number): void {
    if (!this.isRunning) return;

    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.05);
    this.lastTimestamp = timestamp;

    // Branch: EV augmented mode vs keyboard mode
    if (this.inputMode === 'ev-augmented') {
      this.loopEvAugmented(dt, timestamp);
    } else {
      this.loopKeyboard(dt, timestamp);
    }

    // Common: update audio
    this.audioEngine.update(this.state);

    // Common: tire squeal
    this.audioEngine.updateTireSqueal(this.state.wheelSlip);

    // Common: dashboard & gear display
    this.dashboard.render(this.state);
    this.controls.updateGearDisplay(
      this.transmission.gear,
      this.transmission.isShifting,
    );

    // Next frame
    this.animFrameId = requestAnimationFrame((t) => this.loop(t));
  }

  /** EV augmented mode: sensors drive RPM, gear, and throttle */
  private loopEvAugmented(dt: number, timestamp: number): void {
    // Still read controls for transmission mode and manual shifts
    const input = this.controls.update(dt);
    this.transmission.update(dt);
    this.transmission.mode = input.transmissionMode;

    // Handle manual shifts in EV mode
    if (input.shiftUpPressed) {
      if (input.transmissionMode === 'automatic' && this.transmission.gear > 0) {
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

    const sensorState = this.sensorProvider.update(dt);
    const result = this.evLoop.update(
      sensorState,
      this.profile,
      this.transmission,
      dt,
      timestamp,
      input.transmissionMode,
    );

    this.state = result.engineState;

    // EV mode decel crackle
    if (result.decelCrackle) {
      this.audioEngine.triggerDecelCrackle();
    }

    // BOV from turbo
    if (result.bovEnvelope > 0.01) {
      this.audioEngine.triggerBOV(result.bovEnvelope);
    }

    // Rev limiter pops
    if (this.state.revLimiterActive) {
      this.audioEngine.triggerRevLimiterPop();
    }
  }

  /** Keyboard mode: full physics simulation (original loop logic) */
  private loopKeyboard(dt: number, timestamp: number): void {
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
    const isLaunchCondition =
      this.transmission.gear === 1 &&
      input.brake > 0.5 &&
      input.throttle > 0.8 &&
      this.state.speedMs < 1.0;

    if (isLaunchCondition) {
      this.launchControlActive = true;
    } else if (this.launchControlActive) {
      if (input.brake < 0.1) {
        this.launchControlActive = false;
        this.launchPhaseTimer = 1.5;
      } else if (input.throttle < 0.3) {
        this.launchControlActive = false;
        this.launchPhaseTimer = 0;
      }
    }

    if (this.launchPhaseTimer > 0) {
      this.launchPhaseTimer = Math.max(0, this.launchPhaseTimer - dt);
    }

    if (this.launchControlActive && input.brake > 0.3) {
      this.vehicleDynamics.reset();
    }

    // 4. Clutch model
    const CLUTCH_LOCK_SPEED = 12.0;
    const speedMsPrev = this.state.speedMs;
    const gear = this.transmission.gear;
    const wheelRpmPrev = gear >= 1
      ? this.transmission.speedToRPM(speedMsPrev, gear)
      : this.profile.idleRPM;

    let clutchEngagement = 1.0;
    let engineRPM: number;

    if (gear === 0) {
      engineRPM = this.state.rpm;
    } else if (this.launchControlActive) {
      engineRPM = this.state.rpm;
      clutchEngagement = 0;
    } else if (speedMsPrev < CLUTCH_LOCK_SPEED && gear >= 1) {
      const ratio = speedMsPrev / CLUTCH_LOCK_SPEED;
      clutchEngagement = Math.min(1, ratio * ratio);

      if (this.launchPhaseTimer > 0) {
        const launchFactor = 0.2 + 0.8 * (1 - this.launchPhaseTimer / 1.5);
        clutchEngagement *= launchFactor;
      }

      if (input.throttle < 0.05) {
        engineRPM = this.profile.idleRPM;
        clutchEngagement = 0;
      } else {
        clutchEngagement = Math.max(0.35 * input.throttle, clutchEngagement);
        const freeRevTarget = this.profile.idleRPM +
          input.throttle * (this.profile.redlineRPM - this.profile.idleRPM) * 0.85;
        engineRPM = freeRevTarget * (1 - clutchEngagement)
          + wheelRpmPrev * clutchEngagement;
        engineRPM = Math.max(engineRPM, this.profile.idleRPM);
      }
    } else {
      engineRPM = Math.max(wheelRpmPrev, this.profile.idleRPM);
    }

    // 5. Engine torque
    const torque = getEngineTorque(engineRPM, input.throttle, this.profile);

    // 6. Turbo
    let boostBar = 0;
    if (this.turboModel) {
      const turboResult = this.turboModel.update(engineRPM, input.throttle, dt);
      boostBar = turboResult.boostBar;
      if (turboResult.bovActive) {
        this.audioEngine.triggerBOV(turboResult.bovEnvelope);
      }
    }

    let effectiveTorque: number;
    if (this.profile.turbo && this.turboModel) {
      const boostNorm = boostBar / this.profile.turbo.maxBoostBar;
      effectiveTorque = torque * (0.65 + 0.35 * boostNorm);
    } else {
      effectiveTorque = torque;
    }

    // Rev limiter
    const limiterResult = applyRevLimiter(
      engineRPM, this.profile, this.revLimiterPhase, dt,
    );
    this.revLimiterPhase = limiterResult.newPhase;
    effectiveTorque *= limiterResult.torqueMultiplier;
    if (limiterResult.popTriggered) {
      this.audioEngine.triggerRevLimiterPop();
    }

    const displayTorque = effectiveTorque;

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

    // 8. RPM display
    let rpm: number;
    const wheelRpm = this.transmission.speedToRPM(speedMs, this.transmission.gear);

    if (gear === 0) {
      const targetRpm = input.throttle > 0.05
        ? this.profile.idleRPM +
          input.throttle * (this.profile.redlineRPM - this.profile.idleRPM) * 1.05
        : this.profile.idleRPM;

      let effectiveTarget = targetRpm;
      if (this.state.rpm >= this.profile.redlineRPM - 100 && limiterResult.torqueMultiplier < 0.1) {
        effectiveTarget = Math.min(effectiveTarget, this.profile.redlineRPM - 200);
      }

      const tau = effectiveTarget > this.state.rpm ? 0.15 : 0.4;
      rpm = this.state.rpm + (effectiveTarget - this.state.rpm) * Math.min(1, dt / tau);
    } else if (this.launchControlActive) {
      const launchRpm = Math.min(
        this.profile.peakPowerRPM * 0.7,
        this.profile.redlineRPM * 0.65,
      );
      const tau = 0.1;
      rpm = this.state.rpm + (launchRpm - this.state.rpm) * Math.min(1, dt / tau);
    } else if (clutchEngagement < 0.99 && gear >= 1 && input.throttle >= 0.05) {
      const ratio = speedMs / CLUTCH_LOCK_SPEED;
      let clutchNow = Math.min(1, ratio * ratio);
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
      rpm = speedMs <= 0 ? this.profile.idleRPM : wheelRpm;
    } else {
      rpm = this.profile.idleRPM;
    }

    if (gear >= 1 && speedMs > 0 && clutchEngagement >= 0.99) {
      rpm = Math.max(0, Math.min(this.profile.redlineRPM, rpm));
    } else {
      rpm = clampRPM(rpm, this.profile);
    }

    // Auto shift
    if (input.transmissionMode === 'automatic') {
      this.transmission.checkAutoShift(rpm, input.throttle, timestamp);
    }

    // Power
    const showTorque = this.launchControlActive ? displayTorque : effectiveTorque;
    const { kw, hp } = computePower(showTorque, rpm);

    // Update state
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

    // Decel crackle
    if (
      this.prevThrottle > 0.7 &&
      input.throttle < 0.2 &&
      rpm > this.profile.redlineRPM * 0.6
    ) {
      this.audioEngine.triggerDecelCrackle();
    }
    this.prevThrottle = input.throttle;
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
    this.evLoop.reset();
    this.evLoop.setTurbo(profile.turbo);
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
