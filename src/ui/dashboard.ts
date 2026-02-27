import type { EngineProfile, EngineState } from '../domain/types';
import { PerfGraph } from './perf-graph';

export class Dashboard {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private gaugesEl: HTMLElement;
  private profile: EngineProfile;
  // Logical (CSS pixel) dimensions
  private logicalW: number = 600;
  private logicalH: number = 500;
  private lastState: EngineState | null = null;

  // Gauge DOM elements
  private speedVal!: HTMLElement;
  private accelVal!: HTMLElement;
  private powerVal!: HTMLElement;
  private torqueVal!: HTMLElement;
  private boostVal!: HTMLElement;
  private boostCard!: HTMLElement;

  // Speed bar elements
  private speedBarFill!: HTMLElement;
  private speedBarValue!: HTMLElement;
  private speedBarMax!: HTMLElement;
  private maxSpeedKmh: number;

  // Performance graph
  private perfGraph!: PerfGraph;

  constructor(canvasId: string, gaugesId: string, profile: EngineProfile) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.gaugesEl = document.getElementById(gaugesId)!;
    this.profile = profile;
    this.maxSpeedKmh = this.calculateMaxSpeed(profile);

    this.buildSpeedBar();
    this.buildGauges();
    this.setupResize();
    this.resizeCanvas();

    // Performance graph below tachometer
    this.perfGraph = new PerfGraph('dashboard-container', profile);

    // Draw initial tachometer (engine off state) so it's visible immediately
    this.drawTachometer(0, 0, false, false);
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
    this.boostCard.style.display = profile.turbo ? '' : 'none';
    this.maxSpeedKmh = this.calculateMaxSpeed(profile);
    this.speedBarMax.textContent = Math.round(this.maxSpeedKmh).toString();
    this.perfGraph.setProfile(profile);
    // Redraw tachometer with new profile scale
    this.lastState = null;
    this.drawTachometer(0, 0, false, false);
  }

  render(state: EngineState): void {
    this.lastState = state;
    this.drawTachometer(state.rpm, state.gear, state.isShifting, state.revLimiterActive);
    this.updateGauges(state);
    this.updateSpeedBar(state.speedKmh);
    this.perfGraph.update(state);
  }

  private calculateMaxSpeed(profile: EngineProfile): number {
    const peakPowerW = profile.peakPower * 1000; // kW -> W
    const rho = 1.225;
    const Cd = profile.dragCoefficient;
    const A = profile.frontalArea;
    const Crr = profile.rollingResistance;
    const m = profile.vehicleMass;
    const g = 9.81;
    const drivetrainEff = 0.85;

    // Binary search: find v where drag+rolling power = peak power × efficiency
    let low = 0;
    let high = 200; // m/s = 720 km/h
    for (let i = 0; i < 50; i++) {
      const v = (low + high) / 2;
      const pDrag = 0.5 * Cd * rho * A * v * v * v;
      const pRolling = Crr * m * g * v;
      if (pDrag + pRolling < peakPowerW * drivetrainEff) {
        low = v;
      } else {
        high = v;
      }
    }
    const vAero = (low + high) / 2;

    // Also cap by mechanical limit (redline in top gear)
    const topGearRatio = profile.gearRatios[profile.gearRatios.length - 1];
    const vMech =
      (profile.redlineRPM * 2 * Math.PI * profile.wheelRadius) /
      (topGearRatio * profile.finalDrive * 60);

    return Math.min(vAero, vMech) * 3.6;
  }

  private buildSpeedBar(): void {
    const dashContainer = this.canvas.parentElement!;

    // Create wrapper that holds speed bar + canvas side by side
    const tachoArea = document.createElement('div');
    tachoArea.id = 'tacho-area';

    const speedBarContainer = document.createElement('div');
    speedBarContainer.className = 'speed-bar-container';
    speedBarContainer.innerHTML = `
      <div class="speed-bar-max" id="speed-bar-max">${Math.round(this.maxSpeedKmh)}</div>
      <div class="speed-bar-track">
        <div class="speed-bar-fill" id="speed-bar-fill"></div>
      </div>
      <div class="speed-bar-value" id="speed-bar-value">0</div>
      <div class="speed-bar-unit">km/h</div>
    `;

    // Move canvas into tacho area
    dashContainer.insertBefore(tachoArea, this.canvas);
    tachoArea.appendChild(speedBarContainer);
    tachoArea.appendChild(this.canvas);

    this.speedBarFill = document.getElementById('speed-bar-fill')!;
    this.speedBarValue = document.getElementById('speed-bar-value')!;
    this.speedBarMax = document.getElementById('speed-bar-max')!;
  }

  private updateSpeedBar(speedKmh: number): void {
    const pct = Math.min(100, (speedKmh / this.maxSpeedKmh) * 100);
    this.speedBarFill.style.height = `${pct}%`;
    this.speedBarValue.textContent = speedKmh.toFixed(0);
  }

  private buildGauges(): void {
    this.gaugesEl.innerHTML = '';
    const gauges = [
      { id: 'speed', label: 'Vitesse', unit: 'km/h' },
      { id: 'accel', label: 'Acc\u00e9l\u00e9ration', unit: 'G' },
      { id: 'power', label: 'Puissance', unit: 'ch' },
      { id: 'torque', label: 'Couple', unit: 'Nm' },
      { id: 'boost', label: 'Boost', unit: 'bar' },
    ];

    for (const g of gauges) {
      const card = document.createElement('div');
      card.className = 'gauge-card';
      card.id = `gauge-${g.id}`;
      card.innerHTML = `
        <div class="gauge-label">${g.label}</div>
        <div>
          <span class="gauge-value" id="val-${g.id}">0</span>
          <span class="gauge-unit">${g.unit}</span>
        </div>
      `;
      this.gaugesEl.appendChild(card);
    }

    this.speedVal = document.getElementById('val-speed')!;
    this.accelVal = document.getElementById('val-accel')!;
    this.powerVal = document.getElementById('val-power')!;
    this.torqueVal = document.getElementById('val-torque')!;
    this.boostVal = document.getElementById('val-boost')!;
    this.boostCard = document.getElementById('gauge-boost')!;
    this.boostCard.style.display = this.profile.turbo ? '' : 'none';
  }

  private updateGauges(state: EngineState): void {
    this.speedVal.textContent = state.speedKmh.toFixed(0);
    this.accelVal.textContent = state.accelerationG.toFixed(2);
    this.powerVal.textContent = state.powerHp.toFixed(0);
    this.torqueVal.textContent = state.torqueNm.toFixed(0);
    if (this.profile.turbo) {
      this.boostVal.textContent = state.boostBar.toFixed(2);
    }
  }

  private drawTachometer(
    rpm: number,
    gear: number,
    isShifting: boolean,
    revLimiterActive: boolean,
  ): void {
    const ctx = this.ctx2d;
    const w = this.logicalW;
    const h = this.logicalH;
    const cx = w / 2;
    const cy = h * 0.52;
    const radius = Math.min(w, h) * 0.36;

    // Reset transform and clear
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const startAngle = (5 / 4) * Math.PI;
    const endAngle = (-1 / 4) * Math.PI;
    const sweep = (3 / 2) * Math.PI;

    const maxRPM = Math.ceil(this.profile.redlineRPM / 1000) * 1000;
    const redlineStart = this.profile.redlineRPM;

    // Background arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle, false);
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#1e293b';
    ctx.stroke();

    // Red zone arc
    const redlineAngle = startAngle + (redlineStart / maxRPM) * sweep;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, redlineAngle, endAngle, false);
    ctx.lineWidth = 18;
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.3)';
    ctx.stroke();

    // Active arc (current RPM)
    const rpmFraction = Math.min(rpm, maxRPM) / maxRPM;
    const rpmAngle = startAngle + rpmFraction * sweep;
    const rpmColor = rpm >= redlineStart ? '#e94560' : '#22c55e';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, rpmAngle, false);
    ctx.lineWidth = 18;
    ctx.strokeStyle = rpmColor;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Tick marks every 1000 RPM
    const fontSize = Math.max(11, radius * 0.1);
    ctx.font = `${fontSize}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let rpmTick = 0; rpmTick <= maxRPM; rpmTick += 1000) {
      const angle = startAngle + (rpmTick / maxRPM) * sweep;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const innerR = radius - 12;
      const outerR = radius + 12;
      ctx.beginPath();
      ctx.moveTo(cx + innerR * cos, cy + innerR * sin);
      ctx.lineTo(cx + outerR * cos, cy + outerR * sin);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rpmTick >= redlineStart ? '#e94560' : '#556';
      ctx.stroke();

      // Label
      const labelR = radius + 24;
      ctx.fillStyle = rpmTick >= redlineStart ? '#e94560' : '#889';
      ctx.fillText(
        String(rpmTick / 1000),
        cx + labelR * cos,
        cy + labelR * sin,
      );
    }

    // Small ticks every 500
    for (let rpmTick = 500; rpmTick < maxRPM; rpmTick += 1000) {
      const angle = startAngle + (rpmTick / maxRPM) * sweep;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(
        cx + (radius - 6) * cos,
        cy + (radius - 6) * sin,
      );
      ctx.lineTo(
        cx + (radius + 6) * cos,
        cy + (radius + 6) * sin,
      );
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#334';
      ctx.stroke();
    }

    // Needle
    const needleAngle =
      startAngle + (Math.min(rpm, maxRPM) / maxRPM) * sweep;
    const needleLen = radius - 22;
    ctx.save();
    ctx.shadowColor = rpmColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + needleLen * Math.cos(needleAngle),
      cy + needleLen * Math.sin(needleAngle),
    );
    ctx.lineWidth = 3;
    ctx.strokeStyle = rpmColor;
    ctx.stroke();
    ctx.restore();

    // Center cap
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#445';
    ctx.fill();

    // RPM numeric display — flash red when rev limiter active
    ctx.fillStyle = revLimiterActive ? '#e94560' : '#eee';
    ctx.font = `bold ${Math.max(20, radius * 0.22)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(rpm).toString(), cx, cy + radius * 0.32);

    ctx.font = `${Math.max(10, radius * 0.08)}px system-ui`;
    ctx.fillStyle = '#667';
    ctx.fillText('RPM', cx, cy + radius * 0.44);

    // Gear indicator in center-top
    const gearText = gear === 0 ? 'N' : String(gear);
    ctx.font = `bold ${Math.max(24, radius * 0.2)}px system-ui`;
    ctx.fillStyle = isShifting ? '#eab308' : '#22c55e';
    ctx.fillText(gearText, cx, cy - radius * 0.12);

    // Launch control indicator & wheel slip bar (uses lastState)
    if (this.lastState) {
      // LC LED (blinking orange when active)
      if (this.lastState.launchControlActive) {
        const blink = Math.sin(Date.now() * 0.01) > 0;
        if (blink) {
          ctx.fillStyle = '#eab308';
          ctx.font = `bold ${Math.max(10, radius * 0.09)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText('LC', cx, cy + radius * 0.58);
        }
      }

      // Wheel slip bar (below tachometer)
      if (this.lastState.wheelSlip > 0.01) {
        const barW = radius * 1.2;
        const barH = 6;
        const barX = cx - barW / 2;
        const barY = cy + radius * 0.68;

        // Track background
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, 3);
        ctx.fill();

        // Fill (green -> yellow -> red based on slip)
        const slip = Math.min(1, this.lastState.wheelSlip);
        const fillW = barW * slip;
        const slipColor = slip < 0.3 ? '#22c55e' : slip < 0.6 ? '#eab308' : '#e94560';
        ctx.fillStyle = slipColor;
        ctx.beginPath();
        ctx.roundRect(barX, barY, fillW, barH, 3);
        ctx.fill();

        // Label
        ctx.fillStyle = '#889';
        ctx.font = `${Math.max(8, radius * 0.06)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(`SLIP ${Math.round(slip * 100)}%`, cx, barY + barH + 10);
      }
    }
  }

  private setupResize(): void {
    const observer = new ResizeObserver(() => this.resizeCanvas());
    observer.observe(this.canvas.parentElement!);
  }

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement!;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Width limited to 600px or parent width
    const maxW = Math.min(rect.width - 50, 600); // -50 for speed bar
    // Height derived from width (tachometer is round, needs ~square canvas)
    // Use 0.8 ratio since the dial doesn't use full height (270° arc)
    const maxH = Math.max(180, maxW * 0.75);
    this.logicalW = maxW;
    this.logicalH = maxH;
    this.canvas.width = maxW * dpr;
    this.canvas.height = maxH * dpr;
    this.canvas.style.width = `${maxW}px`;
    this.canvas.style.height = `${maxH}px`;

    // Re-render tachometer after resize to avoid blank canvas
    if (this.lastState) {
      this.render(this.lastState);
    }
  }
}
