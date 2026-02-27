import type { EngineProfile } from '../domain/types';
import type { ProfileGroup } from '../data/profile-loader';

export class ProfileSelector {
  private container: HTMLElement;
  private groups: ProfileGroup[];
  private activeId: string;
  private onSelect: (profile: EngineProfile) => void;

  constructor(
    containerId: string,
    groups: ProfileGroup[],
    defaultProfile: EngineProfile,
    onSelect: (profile: EngineProfile) => void,
  ) {
    this.container = document.getElementById(containerId)!;
    this.groups = groups;
    this.activeId = defaultProfile.id;
    this.onSelect = onSelect;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';
    for (const group of this.groups) {
      // Group label
      const label = document.createElement('span');
      label.className = 'profile-group-label';
      label.textContent = group.label;
      this.container.appendChild(label);

      for (const profile of group.profiles) {
        const btn = document.createElement('button');
        btn.className =
          profile.id === this.activeId ? 'profile-btn active' : 'profile-btn';
        btn.textContent = profile.name;
        btn.addEventListener('click', () => {
          if (profile.id === this.activeId) return;
          this.activeId = profile.id;
          this.onSelect(profile);
          this.render();
        });
        this.container.appendChild(btn);
      }
    }
  }
}
