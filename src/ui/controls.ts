import type { TransmissionMode, InputMode } from '../domain/types';
import type { SensorStatus } from '../sensors/sensor-provider';

export interface ControlState {
  throttle: number;
  brake: number;
  shiftUpPressed: boolean;
  shiftDownPressed: boolean;
  transmissionMode: TransmissionMode;
}

export type VolumeCallback = (vol: number) => void;
export type PowerCallback = (on: boolean) => void;
export type InputModeCallback = (mode: InputMode) => void;

export class Controls {
  private throttle: number = 0;
  private brake: number = 0;
  private keysDown: Set<string> = new Set();
  private _shiftUpPressed: boolean = false;
  private _shiftDownPressed: boolean = false;
  private _transmissionMode: TransmissionMode = 'automatic';
  private container: HTMLElement;
  private throttleSlider!: HTMLInputElement;
  private brakeSlider!: HTMLInputElement;
  private throttleValEl!: HTMLElement;
  private brakeValEl!: HTMLElement;
  private gearNumberEl!: HTMLElement;
  private autoBtn!: HTMLButtonElement;
  private manualBtn!: HTMLButtonElement;
  private powerBtn!: HTMLButtonElement;
  private volumeCallback: VolumeCallback | null = null;
  private powerCallback: PowerCallback | null = null;
  private inputModeCallback: InputModeCallback | null = null;
  private _isEngineOn: boolean = false;
  private _inputMode: InputMode = 'keyboard';
  private evBtn!: HTMLButtonElement;
  private keyboardBtn!: HTMLButtonElement;
  private evStatusEl!: HTMLElement;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.buildUI();
    this.setupKeyboard();
  }

  get transmissionMode(): TransmissionMode {
    return this._transmissionMode;
  }

  onVolumeChange(cb: VolumeCallback): void {
    this.volumeCallback = cb;
  }

  onPowerChange(cb: PowerCallback): void {
    this.powerCallback = cb;
  }

  onInputModeChange(cb: InputModeCallback): void {
    this.inputModeCallback = cb;
  }

  get inputMode(): InputMode {
    return this._inputMode;
  }

  setEvStatus(status: SensorStatus): void {
    if (!this.evStatusEl) return;
    switch (status.state) {
      case 'inactive':
        this.evStatusEl.innerHTML = '';
        break;
      case 'requesting':
        this.evStatusEl.innerHTML =
          '<span class="ev-status-dot requesting"></span>En attente GPS...';
        break;
      case 'active':
        this.evStatusEl.innerHTML =
          `<span class="ev-status-dot active"></span>GPS actif (${Math.round(status.accuracy)}m)`;
        break;
      case 'error': {
        const reasons: Record<string, string> = {
          'permission-denied': 'Permission refus\u00e9e',
          'unavailable': 'GPS indisponible',
          'timeout': 'Timeout GPS',
          'insecure-context': 'HTTPS requis',
        };
        this.evStatusEl.innerHTML =
          `<span class="ev-status-dot error"></span>${reasons[status.reason]}`;
        break;
      }
    }
  }

  revertToKeyboard(): void {
    this._inputMode = 'keyboard';
    this.keyboardBtn.classList.add('active');
    this.evBtn.classList.remove('active');
    this.container.classList.remove('ev-active');
    this.setEvStatus({ state: 'inactive' });
  }

  simulatePowerOn(): void {
    if (!this._isEngineOn) {
      this._isEngineOn = true;
      this.powerBtn.classList.add('on');
      this.powerCallback?.(true);
    }
  }

  updateGearDisplay(gear: number, isShifting: boolean): void {
    const text = gear === 0 ? 'N' : String(gear);
    this.gearNumberEl.textContent = text;
    this.gearNumberEl.className = isShifting
      ? 'gear-number shifting'
      : 'gear-number';
  }

  update(dt: number): ControlState {
    const rampRate = 3.0;
    const decayRate = 5.0;

    // Keyboard throttle
    if (this.keysDown.has('w') || this.keysDown.has('arrowup')) {
      this.throttle = Math.min(1, this.throttle + rampRate * dt);
    } else {
      this.throttle = Math.max(0, this.throttle - decayRate * dt);
    }

    // Keyboard brake
    if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) {
      this.brake = Math.min(1, this.brake + rampRate * dt);
    } else {
      this.brake = Math.max(0, this.brake - decayRate * dt);
    }

    // Combine with slider
    const sliderThrottle = parseFloat(this.throttleSlider.value) / 100;
    const sliderBrake = parseFloat(this.brakeSlider.value) / 100;
    const effectiveThrottle = Math.max(this.throttle, sliderThrottle);
    const effectiveBrake = Math.max(this.brake, sliderBrake);

    // Update visual feedback
    this.throttleValEl.textContent = `${Math.round(effectiveThrottle * 100)}%`;
    this.brakeValEl.textContent = `${Math.round(effectiveBrake * 100)}%`;

    const state: ControlState = {
      throttle: effectiveThrottle,
      brake: effectiveBrake,
      shiftUpPressed: this._shiftUpPressed,
      shiftDownPressed: this._shiftDownPressed,
      transmissionMode: this._transmissionMode,
    };

    // Reset one-shot flags
    this._shiftUpPressed = false;
    this._shiftDownPressed = false;

    return state;
  }

  private buildUI(): void {
    this.container.innerHTML = `
      <div class="control-section power-section">
        <button class="power-btn" id="power-btn" title="D\u00e9marrer / Arr\u00eater le moteur">
          <span class="power-icon">\u23FB</span>
        </button>
      </div>

      <div class="control-section ev-section">
        <div class="control-label">Mode</div>
        <div class="mode-toggle ev-mode-toggle">
          <button id="mode-keyboard" class="active">Clavier</button>
          <button id="mode-ev">EV+</button>
        </div>
        <div class="ev-status" id="ev-status"></div>
      </div>

      <div class="control-section">
        <div class="control-label">P\u00e9dales</div>
        <div class="pedal-container">
          <div class="pedal-wrapper">
            <span class="pedal-value" id="throttle-val">0%</span>
            <input type="range" min="0" max="100" value="0"
                   class="pedal-slider throttle" id="throttle-slider" orient="vertical">
            <span class="pedal-name">Gaz</span>
          </div>
          <div class="pedal-wrapper">
            <span class="pedal-value" id="brake-val">0%</span>
            <input type="range" min="0" max="100" value="0"
                   class="pedal-slider brake" id="brake-slider" orient="vertical">
            <span class="pedal-name">Frein</span>
          </div>
        </div>
      </div>

      <div class="control-section">
        <div class="control-label">Rapport</div>
        <div class="gear-display">
          <button class="gear-btn" id="gear-down">\u25C0</button>
          <span class="gear-number" id="gear-number">N</span>
          <button class="gear-btn" id="gear-up">\u25B6</button>
        </div>
      </div>

      <div class="control-section">
        <div class="control-label">Transmission</div>
        <div class="mode-toggle">
          <button id="mode-auto" class="active">Auto</button>
          <button id="mode-manual">Manuel</button>
        </div>
      </div>

      <div class="control-section">
        <div class="control-label">Volume</div>
        <input type="range" min="0" max="100" value="70"
               class="volume-slider" id="volume-slider">
      </div>

      <div class="control-section key-hints-compact">
        <span><kbd>W</kbd>/<kbd>S</kbd> Gaz/Frein</span>
        <span><kbd>A</kbd>/<kbd>D</kbd> Rapports</span>
      </div>
    `;

    // Power button
    this.powerBtn = document.getElementById('power-btn') as HTMLButtonElement;
    this.powerBtn.addEventListener('click', () => {
      this._isEngineOn = !this._isEngineOn;
      this.powerBtn.classList.toggle('on', this._isEngineOn);
      this.powerCallback?.(this._isEngineOn);
    });

    // EV mode toggle
    this.keyboardBtn = document.getElementById('mode-keyboard') as HTMLButtonElement;
    this.evBtn = document.getElementById('mode-ev') as HTMLButtonElement;
    this.evStatusEl = document.getElementById('ev-status')!;

    this.keyboardBtn.addEventListener('click', () => {
      if (this._inputMode === 'keyboard') return;
      this._inputMode = 'keyboard';
      this.keyboardBtn.classList.add('active');
      this.evBtn.classList.remove('active');
      this.container.classList.remove('ev-active');
      this.inputModeCallback?.('keyboard');
    });

    this.evBtn.addEventListener('click', () => {
      if (this._inputMode === 'ev-augmented') return;
      this._inputMode = 'ev-augmented';
      this.evBtn.classList.add('active');
      this.keyboardBtn.classList.remove('active');
      this.container.classList.add('ev-active');
      this.inputModeCallback?.('ev-augmented');
    });

    this.throttleSlider = document.getElementById(
      'throttle-slider',
    ) as HTMLInputElement;
    this.brakeSlider = document.getElementById(
      'brake-slider',
    ) as HTMLInputElement;
    this.throttleValEl = document.getElementById('throttle-val')!;
    this.brakeValEl = document.getElementById('brake-val')!;
    this.gearNumberEl = document.getElementById('gear-number')!;
    this.autoBtn = document.getElementById('mode-auto') as HTMLButtonElement;
    this.manualBtn = document.getElementById(
      'mode-manual',
    ) as HTMLButtonElement;

    // Gear buttons
    document.getElementById('gear-down')!.addEventListener('click', () => {
      this._shiftDownPressed = true;
    });
    document.getElementById('gear-up')!.addEventListener('click', () => {
      this._shiftUpPressed = true;
    });

    // Mode toggle
    this.autoBtn.addEventListener('click', () => {
      this._transmissionMode = 'automatic';
      this.autoBtn.classList.add('active');
      this.manualBtn.classList.remove('active');
    });
    this.manualBtn.addEventListener('click', () => {
      this._transmissionMode = 'manual';
      this.manualBtn.classList.add('active');
      this.autoBtn.classList.remove('active');
    });

    // Volume
    const volSlider = document.getElementById(
      'volume-slider',
    ) as HTMLInputElement;
    volSlider.addEventListener('input', () => {
      this.volumeCallback?.(parseFloat(volSlider.value) / 100);
    });
  }

  private setupKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keysDown.add(key);
      if (key === 'a' || key === 'arrowleft') this._shiftDownPressed = true;
      if (key === 'd' || key === 'arrowright') this._shiftUpPressed = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.key.toLowerCase());
    });
  }
}
