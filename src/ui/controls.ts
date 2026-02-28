import type { TransmissionMode, InputMode } from '../domain/types';
import type { SensorStatus } from '../sensors/sensor-provider';
import type { AudioDebugInfo, ToneOptions } from '../audio/audio-engine';

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
export type ToneCallback = (options: ToneOptions) => void;

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
  private hornClickCallback: (() => void | Promise<void>) | null = null;
  private audioDebugGetter: (() => AudioDebugInfo) | null = null;
  private audioDebugIntervalId: number = 0;
  private toneCallback: ToneCallback | null = null;

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

  setHornClick(cb: () => void | Promise<void>): void {
    this.hornClickCallback = cb;
  }

  setAudioDebugGetter(getter: () => AudioDebugInfo): void {
    this.audioDebugGetter = getter;
    if (!this.audioDebugIntervalId) {
      this.updateAudioDebug();
      this.audioDebugIntervalId = window.setInterval(() => this.updateAudioDebug(), 1500);
    }
  }

  onToneChange(cb: ToneCallback): void {
    this.toneCallback = cb;
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

  private pedalSvg(kind: 'brake' | 'throttle'): string {
    const isBrake = kind === 'brake';
    const color = isBrake ? '#e94560' : '#22c55e';
    const w = 28;
    const h = 14;
    return `<svg class="pedal-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="26" height="8" rx="3" stroke="${color}" stroke-width="1.5" fill="${color}20"/></svg>`;
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
          <div class="pedal-wrapper" data-pedal="brake">
            <div class="pedal-touch" id="brake-touch" title="Frein (toucher / maintenir)">
              <span class="pedal-icon pedal-icon-brake" aria-hidden="true">${this.pedalSvg('brake')}</span>
              <span class="pedal-value" id="brake-val">0%</span>
            </div>
            <input type="range" min="0" max="100" value="0"
                   class="pedal-slider brake" id="brake-slider" orient="vertical">
            <span class="pedal-name">Frein</span>
          </div>
          <div class="pedal-wrapper" data-pedal="throttle">
            <div class="pedal-touch" id="throttle-touch" title="Gaz (toucher / maintenir)">
              <span class="pedal-icon pedal-icon-throttle" aria-hidden="true">${this.pedalSvg('throttle')}</span>
              <span class="pedal-value" id="throttle-val">0%</span>
            </div>
            <input type="range" min="0" max="100" value="0"
                   class="pedal-slider throttle" id="throttle-slider" orient="vertical">
            <span class="pedal-name">Gaz</span>
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

      <div class="control-section">
        <div class="control-label">Son</div>
        <div class="tone-sliders">
          <label class="tone-label"><span>Grave</span><span id="bass-val">12</span> dB</label>
          <input type="range" min="0" max="12" value="12" class="tone-slider" id="bass-slider">
          <label class="tone-label"><span>Reverb</span><span id="reverb-val">33</span> %</label>
          <input type="range" min="0" max="100" value="33" class="tone-slider" id="reverb-slider">
        </div>
      </div>

      <div class="control-section">
        <div class="control-label">Test son</div>
        <button type="button" class="horn-btn" id="horn-btn" title="Tester la sortie audio (klaxon)">
          \uD83C\uDFA4 Klaxon
        </button>
        <div class="audio-debug" id="audio-debug" aria-live="polite"></div>
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

    this.setupPedalTouch();
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

    // Tone (bass + reverb)
    const bassSlider = document.getElementById('bass-slider') as HTMLInputElement;
    const reverbSlider = document.getElementById('reverb-slider') as HTMLInputElement;
    const bassValEl = document.getElementById('bass-val')!;
    const reverbValEl = document.getElementById('reverb-val')!;
    const emitTone = () => {
      const bassDb = parseFloat(bassSlider.value);
      const reverbWet = parseFloat(reverbSlider.value) / 100;
      bassValEl.textContent = String(bassDb);
      reverbValEl.textContent = String(Math.round(reverbWet * 100));
      this.toneCallback?.({ bassDb, reverbWet });
    };
    if (bassSlider) {
      bassSlider.addEventListener('input', emitTone);
      bassValEl.textContent = bassSlider.value;
    }
    if (reverbSlider) {
      reverbSlider.addEventListener('input', emitTone);
      reverbValEl.textContent = reverbSlider.value;
    }
    emitTone(); // applique les valeurs par défaut (grave 12 dB, reverb 33 %)

    // Horn (test sound)
    const hornBtn = document.getElementById('horn-btn');
    if (hornBtn) {
      hornBtn.addEventListener('click', () => {
        const p = this.hornClickCallback?.();
        if (p && typeof (p as Promise<unknown>).then === 'function') {
          (p as Promise<void>).then(() => this.updateAudioDebug());
        } else {
          this.updateAudioDebug();
        }
      });
    }
  }

  private updateAudioDebug(): void {
    const el = document.getElementById('audio-debug');
    if (!el || !this.audioDebugGetter) return;
    const info = this.audioDebugGetter();
    const lines: string[] = [
      `Contexte: ${info.contextState}`,
      info.sampleRate != null ? `Sample rate: ${info.sampleRate} Hz` : '',
      `Worklet: ${info.workletLoaded ? 'oui' : 'non'}`,
      info.source !== 'none' ? `Source: ${info.source}` : '',
      info.canPlay ? 'Sortie: OK' : info.contextState === 'suspended' ? 'Sortie: débloquer (geste utilisateur)' : info.contextState === 'non initialisé' ? 'Sortie: cliquez Klaxon ou Power' : 'Sortie: —',
    ].filter(Boolean);
    el.textContent = lines.join(' · ');
    el.className = 'audio-debug' + (info.canPlay ? ' audio-ok' : '');
  }

  private setupPedalTouch(): void {
    const bindPedal = (touchEl: HTMLElement, slider: HTMLInputElement) => {
      const setValue = (v: number) => {
        slider.value = String(v);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const onDown = (e: PointerEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        (e.currentTarget as HTMLElement).classList.add('pressed');
        setValue(100);
      };
      const onUp = (e: PointerEvent) => {
        (e.currentTarget as HTMLElement).classList.remove('pressed');
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        setValue(0);
      };
      touchEl.addEventListener('pointerdown', onDown);
      touchEl.addEventListener('pointerup', onUp);
      touchEl.addEventListener('pointerleave', onUp);
      touchEl.addEventListener('pointercancel', onUp);
    };
    const brakeTouch = document.getElementById('brake-touch')!;
    const throttleTouch = document.getElementById('throttle-touch')!;
    bindPedal(brakeTouch, this.brakeSlider);
    bindPedal(throttleTouch, this.throttleSlider);
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
