import type { EngineState, EngineProfile } from '../domain/types';

interface DataPoint {
  time: number;
  speedKmh: number;
}

interface Milestone {
  speedKmh: number;
  time: number;
}

export class PerfGraph {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private data: DataPoint[] = [];
  private timer: number = 0;
  private isRecording: boolean = false;
  private milestones: Milestone[] = [];
  private maxSpeedKmh: number;
  private maxTime: number = 10;

  // Thresholds to track
  private static SPEED_THRESHOLDS = [100, 200];

  constructor(containerId: string, profile: EngineProfile) {
    this.maxSpeedKmh = this.calculateDisplayMax(profile);

    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'perf-graph-canvas';
    this.ctx2d = this.canvas.getContext('2d')!;

    const container = document.getElementById(containerId)!;
    container.appendChild(this.canvas);

    this.setupResize();
    this.resizeCanvas();
  }

  setProfile(profile: EngineProfile): void {
    this.maxSpeedKmh = this.calculateDisplayMax(profile);
    this.reset();
  }

  reset(): void {
    this.data = [];
    this.milestones = [];
    this.timer = 0;
    this.isRecording = false;
  }

  update(state: EngineState): void {
    // Start recording: in gear, throttle applied, near standstill
    if (!this.isRecording) {
      if (state.gear >= 1 && state.throttle > 0.1 && state.speedKmh < 5) {
        this.isRecording = true;
        this.data = [];
        this.milestones = [];
        this.timer = 0;
      }
    }

    if (!this.isRecording) {
      this.draw();
      return;
    }

    // Stop recording if braking or neutral
    if (state.brake > 0.3 || state.gear === 0) {
      this.isRecording = false;
      this.draw();
      return;
    }

    // Record data (cap at ~600 points = 10s @ 60fps)
    this.timer += 1 / 60; // approximate 60fps
    this.data.push({ time: this.timer, speedKmh: state.speedKmh });

    // Check milestones
    for (const threshold of PerfGraph.SPEED_THRESHOLDS) {
      if (
        !this.milestones.find((m) => m.speedKmh === threshold) &&
        state.speedKmh >= threshold
      ) {
        this.milestones.push({ speedKmh: threshold, time: this.timer });
      }
    }

    // Auto-extend time axis
    if (this.timer > this.maxTime - 1) {
      this.maxTime = Math.ceil(this.timer + 5);
    }

    // Limit data points
    if (this.data.length > 1200) {
      // Downsample: keep every other point
      this.data = this.data.filter((_, i) => i % 2 === 0);
    }

    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx2d;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 10, right: 12, bottom: 22, left: 40 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    if (plotW < 20 || plotH < 20) return;

    // Background
    ctx.fillStyle = 'rgba(15, 21, 41, 0.6)';
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // Grid lines (speed)
    ctx.font = '9px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const speedStep = this.maxSpeedKmh > 200 ? 100 : 50;
    for (let s = 0; s <= this.maxSpeedKmh; s += speedStep) {
      const y = pad.top + plotH - (s / this.maxSpeedKmh) * plotH;
      ctx.strokeStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.fillStyle = '#556';
      ctx.fillText(String(s), pad.left - 4, y);
    }

    // Threshold lines (100, 200 km/h)
    for (const threshold of PerfGraph.SPEED_THRESHOLDS) {
      if (threshold > this.maxSpeedKmh) continue;
      const y = pad.top + plotH - (threshold / this.maxSpeedKmh) * plotH;
      ctx.strokeStyle = threshold === 100 ? 'rgba(234, 179, 8, 0.4)' : 'rgba(233, 69, 96, 0.4)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Time axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const timeStep = this.maxTime <= 10 ? 2 : 5;
    for (let t = 0; t <= this.maxTime; t += timeStep) {
      const x = pad.left + (t / this.maxTime) * plotW;
      ctx.fillStyle = '#556';
      ctx.fillText(`${t}s`, x, pad.top + plotH + 4);
    }

    // Speed curve
    if (this.data.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';

      for (let i = 0; i < this.data.length; i++) {
        const d = this.data[i];
        const x = pad.left + (d.time / this.maxTime) * plotW;
        const y = pad.top + plotH - (d.speedKmh / this.maxSpeedKmh) * plotH;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // Milestone badges
    for (const ms of this.milestones) {
      const x = pad.left + (ms.time / this.maxTime) * plotW;
      const y = pad.top + plotH - (ms.speedKmh / this.maxSpeedKmh) * plotH;

      // Dot
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = ms.speedKmh === 100 ? '#eab308' : '#e94560';
      ctx.fill();

      // Badge
      const text = `0-${ms.speedKmh}: ${ms.time.toFixed(1)}s`;
      ctx.font = 'bold 10px system-ui';
      const metrics = ctx.measureText(text);
      const badgeW = metrics.width + 10;
      const badgeH = 16;
      const bx = Math.min(x + 6, pad.left + plotW - badgeW);
      const by = y - badgeH - 4;

      ctx.fillStyle = ms.speedKmh === 100 ? 'rgba(234, 179, 8, 0.85)' : 'rgba(233, 69, 96, 0.85)';
      ctx.beginPath();
      ctx.roundRect(bx, by, badgeW, badgeH, 3);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 5, by + badgeH / 2);
    }

    // Recording indicator
    if (this.isRecording) {
      ctx.fillStyle = '#e94560';
      ctx.beginPath();
      ctx.arc(w - 16, 14, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#889';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('REC', w - 24, 14);
    }
  }

  private calculateDisplayMax(profile: EngineProfile): number {
    // Use a round number above the vehicle's theoretical top speed
    const peakPowerW = profile.peakPower * 1000;
    const rho = 1.225;
    let low = 0;
    let high = 200;
    for (let i = 0; i < 50; i++) {
      const v = (low + high) / 2;
      const pDrag = 0.5 * profile.dragCoefficient * rho * profile.frontalArea * v * v * v;
      const pRolling = profile.rollingResistance * profile.vehicleMass * 9.81 * v;
      if (pDrag + pRolling < peakPowerW * 0.85) low = v; else high = v;
    }
    const topSpeedKmh = ((low + high) / 2) * 3.6;
    // Round up to next 50
    return Math.ceil(topSpeedKmh / 50) * 50;
  }

  private setupResize(): void {
    const observer = new ResizeObserver(() => this.resizeCanvas());
    observer.observe(this.canvas.parentElement!);
  }

  private resizeCanvas(): void {
    const parent = this.canvas.parentElement!;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(rect.width, 600);
    const h = 120;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.draw();
  }
}
