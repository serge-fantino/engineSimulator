import type { EngineProfile } from '../domain/types';
import type { ProfileGroup } from '../data/profile-loader';
import { DetailCharts } from './detail-charts';

type ViewMode = 'carousel' | 'detail';

export class VehicleGallery {
  private container: HTMLElement;
  private groups: ProfileGroup[];
  private activeId: string;
  private activeProfile: EngineProfile;
  private onSelect: (profile: EngineProfile) => void;
  private viewMode: ViewMode = 'carousel';
  private isCompact: boolean = false;
  private detailCharts: DetailCharts | null = null;

  constructor(
    containerId: string,
    groups: ProfileGroup[],
    defaultProfile: EngineProfile,
    onSelect: (profile: EngineProfile) => void,
  ) {
    this.container = document.getElementById(containerId)!;
    this.groups = groups;
    this.activeId = defaultProfile.id;
    this.activeProfile = defaultProfile;
    this.onSelect = onSelect;
    this.render();
  }

  /** Switch to compact mode when engine is running */
  setCompact(compact: boolean): void {
    if (this.isCompact === compact) return;
    this.isCompact = compact;
    this.render();
  }

  private render(): void {
    this.detailCharts?.destroy();
    this.detailCharts = null;
    this.container.innerHTML = '';
    this.container.className = this.isCompact
      ? 'vehicle-gallery compact'
      : 'vehicle-gallery';

    if (this.viewMode === 'carousel') {
      this.renderCarousel();
    } else {
      this.renderDetail();
    }
  }

  private renderCarousel(): void {
    const track = document.createElement('div');
    track.className = this.isCompact ? 'gallery-carousel compact' : 'gallery-carousel';

    for (const group of this.groups) {
      for (const profile of group.profiles) {
        const card = document.createElement('div');
        card.className = profile.id === this.activeId
          ? 'vehicle-card active'
          : 'vehicle-card';

        if (this.isCompact) {
          card.innerHTML = `
            <img src="${profile.imageUrl || ''}" alt="${profile.name}" loading="lazy" />
            <span class="vehicle-card-name-compact">${profile.name.split(' ')[0]}</span>
          `;
        } else {
          const power = profile.peakPower;
          const torque = profile.peakTorque;
          card.innerHTML = `
            <img src="${profile.imageUrl || ''}" alt="${profile.name}" loading="lazy" />
            <div class="vehicle-card-info">
              <div class="vehicle-card-name">${profile.name}</div>
              <div class="vehicle-card-stats">${power} kW · ${torque} Nm · ${profile.displacement}cc</div>
            </div>
          `;
        }

        const img = card.querySelector('img');
        img?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (profile.id !== this.activeId) {
            this.activeId = profile.id;
            this.activeProfile = profile;
            this.onSelect(profile);
          }
          this.viewMode = 'detail';
          this.render();
        });

        card.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('img')) return;
          if (profile.id === this.activeId) return;
          this.activeId = profile.id;
          this.activeProfile = profile;
          this.onSelect(profile);
          this.render();
        });

        track.appendChild(card);
      }
    }

    this.container.appendChild(track);
  }

  private renderDetail(): void {
    const p = this.activeProfile;
    const panel = document.createElement('div');
    panel.className = 'vehicle-detail-panel';

    const gearCount = p.gearRatios.length;
    const aspirationLabel =
      p.aspiration === 'turbo'
        ? 'Turbo'
        : p.aspiration === 'turbo-diesel'
        ? 'Turbo Diesel'
        : 'Atmosphérique';
    const driveLabel =
      p.driveType === 'fwd'
        ? 'Traction avant'
        : p.driveType === 'awd'
        ? 'Intégrale'
        : p.driveType === 'rwd'
        ? 'Traction arrière'
        : '—';

    panel.innerHTML = `
      <div class="detail-content">
        <div class="detail-photo" role="button" tabindex="0" aria-label="Retour à la galerie">
          <img src="${p.imageUrl || ''}" alt="${p.name}" />
        </div>
        <div class="detail-right mode-specs">
          <div class="detail-header">
            <h3 class="detail-title">${p.name}</h3>
            <div class="detail-toggle">
              <button type="button" class="detail-toggle-btn active" data-mode="specs">Fiche</button>
              <button type="button" class="detail-toggle-btn" data-mode="chart">Courbes</button>
            </div>
            <span class="detail-chart-name" aria-hidden="true"></span>
          </div>
          <div class="detail-body">
            <div class="detail-specs">
            <dl class="detail-grid">
              <dt>Type</dt><dd>${p.type}</dd>
              <dt>Cylindrée</dt><dd>${p.displacement} cc</dd>
              <dt>Cylindres</dt><dd>${p.cylinders}</dd>
              <dt>Aspiration</dt><dd>${aspirationLabel}</dd>
              <dt>Traction</dt><dd>${driveLabel}</dd>
              <dt>Puissance</dt><dd>${p.peakPower} kW @ ${p.peakPowerRPM}</dd>
              <dt>Couple</dt><dd>${p.peakTorque} Nm @ ${p.peakTorqueRPM}</dd>
              <dt>Redline</dt><dd>${p.redlineRPM} RPM</dd>
              <dt>Vitesses</dt><dd>${gearCount}</dd>
              <dt>Masse</dt><dd>${p.vehicleMass} kg</dd>
              <dt>P/M</dt><dd>${(p.peakPower / p.vehicleMass * 1000).toFixed(1)} W/kg</dd>
            </dl>
            </div>
            <div class="detail-chart-wrap"></div>
          </div>
        </div>
      </div>
    `;

    const photoEl = panel.querySelector('.detail-photo');
    photoEl?.addEventListener('click', () => {
      this.viewMode = 'carousel';
      this.render();
    });
    photoEl?.addEventListener('keydown', (e: Event) => {
      const ev = e as KeyboardEvent;
      if (ev.key === 'Enter' || ev.key === ' ') {
        e.preventDefault();
        this.viewMode = 'carousel';
        this.render();
      }
    });

    const right = panel.querySelector('.detail-right') as HTMLElement | null;
    const toggleButtons = panel.querySelectorAll<HTMLButtonElement>(
      '.detail-toggle-btn',
    );

    if (right && toggleButtons.length) {
      toggleButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.mode === 'chart' ? 'chart' : 'specs';
          right.classList.toggle('mode-specs', mode === 'specs');
          right.classList.toggle('mode-chart', mode === 'chart');
          toggleButtons.forEach((b) =>
            b.classList.toggle('active', b === btn),
          );
        });
      });
    }

    const chartWrap = panel.querySelector('.detail-chart-wrap') as HTMLElement;
    const chartNameEl = panel.querySelector('.detail-chart-name') as HTMLElement;
    if (chartWrap) {
      this.detailCharts = new DetailCharts(chartWrap, this.activeProfile, chartNameEl);
    }

    this.container.appendChild(panel);
  }
}
