import type { EngineProfile } from '../domain/types';
import { computePower } from '../domain/engine-model';

export type DetailChartKind = 'power' | 'torque' | 'power-torque' | 'speed-gears';

const TWO_PI = 2 * Math.PI;

function rpmToSpeedKmh(profile: EngineProfile, rpm: number, gearIndex: number): number {
  const ratio = profile.gearRatios[gearIndex];
  const speedMs = (rpm * TWO_PI * profile.wheelRadius) / (ratio * profile.finalDrive * 60);
  return speedMs * 3.6;
}

function buildPowerCurve(profile: EngineProfile): { rpm: number; kw: number }[] {
  return profile.torqueCurve.map(([rpm, torqueNm]) => ({
    rpm,
    kw: computePower(torqueNm, rpm).kw,
  }));
}

function buildTorqueCurve(profile: EngineProfile): { rpm: number; nm: number }[] {
  return profile.torqueCurve.map(([rpm, nm]) => ({ rpm, nm }));
}

function buildSpeedGearCurves(profile: EngineProfile): { gear: number; points: { rpm: number; kmh: number }[] }[] {
  const step = Math.max(100, Math.floor((profile.redlineRPM - profile.idleRPM) / 50));
  const curves: { gear: number; points: { rpm: number; kmh: number }[] }[] = [];

  for (let g = 0; g < profile.gearRatios.length; g++) {
    const points: { rpm: number; kmh: number }[] = [];
    for (let rpm = profile.idleRPM; rpm <= profile.redlineRPM; rpm += step) {
      points.push({ rpm, kmh: rpmToSpeedKmh(profile, rpm, g) });
    }
    if (points.length > 0 && points[points.length - 1].rpm < profile.redlineRPM) {
      points.push({ rpm: profile.redlineRPM, kmh: rpmToSpeedKmh(profile, profile.redlineRPM, g) });
    }
    curves.push({ gear: g + 1, points });
  }
  return curves;
}

const COLORS = {
  power: '#22c55e',
  torque: '#e94560',
  grid: '#1e293b',
  text: '#556',
  textDim: '#334',
  bg: 'rgba(15, 21, 41, 0.6)',
  stroke: '#2a2a4a',
};

const GEAR_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#e94560', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];

const CHART_KINDS: DetailChartKind[] = ['power', 'torque', 'power-torque', 'speed-gears'];
const CHART_LABELS: Record<DetailChartKind, string> = {
  power: 'Puissance',
  torque: 'Couple',
  'power-torque': 'P + C',
  'speed-gears': 'Vitesse / rapports',
};

export class DetailCharts {
  private profile: EngineProfile;
  private kind: DetailChartKind = 'power';
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resizeObserver: ResizeObserver | null = null;
  private labelEl: HTMLElement | null;

  constructor(container: HTMLElement, profile: EngineProfile, headerLabelEl?: HTMLElement | null) {
    this.profile = profile;
    this.labelEl = headerLabelEl ?? null;

    if (this.labelEl) {
      this.labelEl.textContent = CHART_LABELS[this.kind];
    }

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'detail-chart-canvas';
    this.canvas.title = 'Cliquer pour changer de courbe';
    this.ctx = this.canvas.getContext('2d')!;

    this.canvas.addEventListener('click', () => {
      const idx = CHART_KINDS.indexOf(this.kind);
      const next = CHART_KINDS[(idx + 1) % CHART_KINDS.length];
      this.setChartKind(next);
    });

    container.appendChild(this.canvas);

    this.resizeObserver = new ResizeObserver(() => this.resizeAndDraw());
    this.resizeObserver.observe(this.canvas.parentElement!);
    this.resizeAndDraw();
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
    this.resizeAndDraw();
  }

  setChartKind(kind: DetailChartKind): void {
    if (this.kind === kind) return;
    this.kind = kind;
    if (this.labelEl) this.labelEl.textContent = CHART_LABELS[kind];
    this.draw();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.canvas.remove();
  }

  private resizeAndDraw(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(200, Math.min(rect.width, 500));
    const h = 88;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 8, right: 8, bottom: 20, left: 36 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    if (plotW < 10 || plotH < 10) return;

    ctx.fillStyle = COLORS.bg;
    ctx.strokeStyle = COLORS.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 6);
    ctx.fill();
    ctx.stroke();

    const { idleRPM, redlineRPM } = this.profile;
    const rpmMin = idleRPM;
    const rpmMax = redlineRPM;
    const rpmRange = rpmMax - rpmMin;

    const x = (rpm: number) => pad.left + ((rpm - rpmMin) / rpmRange) * plotW;
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const rpmStep = rpmRange <= 4000 ? 1000 : 2000;
    for (let r = Math.ceil(rpmMin / rpmStep) * rpmStep; r <= rpmMax; r += rpmStep) {
      const xr = x(r);
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(xr, pad.top);
      ctx.lineTo(xr, pad.top + plotH);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.fillText(`${r / 1000}k`, xr, pad.top + plotH + 3);
    }

    if (this.kind === 'power') {
      this.drawPowerCurve(pad, plotW, plotH, x);
    } else if (this.kind === 'torque') {
      this.drawTorqueCurve(pad, plotW, plotH, x);
    } else if (this.kind === 'power-torque') {
      this.drawPowerTorqueCurve(pad, plotW, plotH, x);
    } else {
      this.drawSpeedGearCurves(pad, plotW, plotH, x);
    }
  }

  private drawPowerCurve(
    pad: { top: number; left: number },
    plotW: number,
    plotH: number,
    x: (rpm: number) => number,
  ): void {
    const data = buildPowerCurve(this.profile);
    if (data.length < 2) return;

    const maxKw = Math.max(...data.map((d) => d.kw), this.profile.peakPower * 1.05);
    const y = (kw: number) => pad.top + plotH - (kw / maxKw) * plotH;

    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    const kwStep = maxKw <= 150 ? 50 : 100;
    for (let k = 0; k <= maxKw; k += kwStep) {
      const yk = y(k);
      this.ctx.strokeStyle = COLORS.grid;
      this.ctx.beginPath();
      this.ctx.moveTo(pad.left, yk);
      this.ctx.lineTo(pad.left + plotW, yk);
      this.ctx.stroke();
      this.ctx.fillStyle = COLORS.text;
      this.ctx.fillText(String(k), pad.left - 4, yk);
    }

    this.ctx.beginPath();
    this.ctx.strokeStyle = COLORS.power;
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';
    data.forEach((d, i) => {
      if (i === 0) this.ctx.moveTo(x(d.rpm), y(d.kw));
      else this.ctx.lineTo(x(d.rpm), y(d.kw));
    });
    this.ctx.stroke();
    this.ctx.fillStyle = COLORS.text;
    this.ctx.textAlign = 'left';
    this.ctx.fillText('kW', pad.left + plotW + 2, pad.top + 8);
  }

  private drawTorqueCurve(
    pad: { top: number; left: number },
    plotW: number,
    plotH: number,
    x: (rpm: number) => number,
  ): void {
    const data = buildTorqueCurve(this.profile);
    if (data.length < 2) return;

    const maxNm = Math.max(...data.map((d) => d.nm), this.profile.peakTorque * 1.05);
    const y = (nm: number) => pad.top + plotH - (nm / maxNm) * plotH;

    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    const step = maxNm <= 300 ? 100 : 150;
    for (let n = 0; n <= maxNm; n += step) {
      const yn = y(n);
      this.ctx.strokeStyle = COLORS.grid;
      this.ctx.beginPath();
      this.ctx.moveTo(pad.left, yn);
      this.ctx.lineTo(pad.left + plotW, yn);
      this.ctx.stroke();
      this.ctx.fillStyle = COLORS.text;
      this.ctx.fillText(String(n), pad.left - 4, yn);
    }

    this.ctx.beginPath();
    this.ctx.strokeStyle = COLORS.torque;
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';
    data.forEach((d, i) => {
      if (i === 0) this.ctx.moveTo(x(d.rpm), y(d.nm));
      else this.ctx.lineTo(x(d.rpm), y(d.nm));
    });
    this.ctx.stroke();
    this.ctx.fillStyle = COLORS.text;
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Nm', pad.left + plotW + 2, pad.top + 8);
  }

  private drawPowerTorqueCurve(
    pad: { top: number; left: number },
    plotW: number,
    plotH: number,
    x: (rpm: number) => number,
  ): void {
    const powerData = buildPowerCurve(this.profile);
    const torqueData = buildTorqueCurve(this.profile);
    if (powerData.length < 2 || torqueData.length < 2) return;

    const maxKw = Math.max(...powerData.map((d) => d.kw), this.profile.peakPower * 1.05);
    const maxNm = Math.max(...torqueData.map((d) => d.nm), this.profile.peakTorque * 1.05);

    const yKw = (kw: number) => pad.top + plotH - (kw / maxKw) * plotH;
    const yNm = (nm: number) => pad.top + plotH - (nm / maxNm) * plotH;

    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    const kwStep = maxKw <= 150 ? 50 : 100;
    for (let k = 0; k <= maxKw; k += kwStep) {
      const yk = yKw(k);
      this.ctx.strokeStyle = COLORS.grid;
      this.ctx.beginPath();
      this.ctx.moveTo(pad.left, yk);
      this.ctx.lineTo(pad.left + plotW, yk);
      this.ctx.stroke();
      this.ctx.fillStyle = COLORS.text;
      this.ctx.fillText(String(k), pad.left - 4, yk);
    }

    this.ctx.beginPath();
    this.ctx.strokeStyle = COLORS.power;
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';
    powerData.forEach((d, i) => {
      if (i === 0) this.ctx.moveTo(x(d.rpm), yKw(d.kw));
      else this.ctx.lineTo(x(d.rpm), yKw(d.kw));
    });
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.strokeStyle = COLORS.torque;
    this.ctx.setLineDash([4, 3]);
    torqueData.forEach((d, i) => {
      if (i === 0) this.ctx.moveTo(x(d.rpm), yNm(d.nm));
      else this.ctx.lineTo(x(d.rpm), yNm(d.nm));
    });
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    this.ctx.font = '9px system-ui';
    this.ctx.fillStyle = COLORS.power;
    this.ctx.textAlign = 'left';
    this.ctx.fillText('kW', pad.left + plotW + 2, pad.top + 6);
    this.ctx.fillStyle = COLORS.torque;
    this.ctx.fillText('Nm', pad.left + plotW + 2, pad.top + 16);
  }

  private drawSpeedGearCurves(
    pad: { top: number; left: number },
    plotW: number,
    plotH: number,
    x: (rpm: number) => number,
  ): void {
    const curves = buildSpeedGearCurves(this.profile);
    let maxKmh = 0;
    curves.forEach((c) => {
      c.points.forEach((p) => {
        if (p.kmh > maxKmh) maxKmh = p.kmh;
      });
    });
    maxKmh = Math.ceil(maxKmh / 20) * 20 || 100;
    const y = (kmh: number) => pad.top + plotH - (kmh / maxKmh) * plotH;

    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    const step = maxKmh <= 150 ? 50 : 100;
    for (let v = 0; v <= maxKmh; v += step) {
      const yv = y(v);
      this.ctx.strokeStyle = COLORS.grid;
      this.ctx.beginPath();
      this.ctx.moveTo(pad.left, yv);
      this.ctx.lineTo(pad.left + plotW, yv);
      this.ctx.stroke();
      this.ctx.fillStyle = COLORS.text;
      this.ctx.fillText(String(v), pad.left - 4, yv);
    }

    curves.forEach(({ points }, idx) => {
      const color = GEAR_COLORS[idx % GEAR_COLORS.length];
      this.ctx.beginPath();
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1.5;
      this.ctx.lineJoin = 'round';
      points.forEach((p, i) => {
        if (i === 0) this.ctx.moveTo(x(p.rpm), y(p.kmh));
        else this.ctx.lineTo(x(p.rpm), y(p.kmh));
      });
      this.ctx.stroke();
    });

    this.ctx.font = '8px system-ui';
    this.ctx.textAlign = 'left';
    curves.forEach(({ gear }, idx) => {
      const color = GEAR_COLORS[idx % GEAR_COLORS.length];
      this.ctx.fillStyle = color;
      this.ctx.fillText(`${gear}`, pad.left + plotW + 2, pad.top + 6 + idx * 10);
    });
  }
}
