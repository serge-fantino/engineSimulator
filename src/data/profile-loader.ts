import type { EngineProfile } from '../domain/types';

// Cars
import hondaK20a from './profiles/honda-k20a.json';
import toyota2grfe from './profiles/toyota-2gr-fe.json';
import fordCoyote from './profiles/ford-coyote-50.json';
import bmwB58 from './profiles/bmw-b58.json';
import ferrariF136 from './profiles/ferrari-f136.json';
import vw20tdi from './profiles/vw-20-tdi.json';

// Supercars
import bugattiChiron from './profiles/bugatti-chiron.json';
import bugattiChironSs300 from './profiles/bugatti-chiron-ss300.json';
import lamborghiniAventador from './profiles/lamborghini-aventador.json';
import porsche911gt3 from './profiles/porsche-911-gt3.json';

// Record / extreme
import f1V6Turbo from './profiles/f1-v6-turbo-hybrid.json';

// Motorcycles
import ducatiPanigaleV4 from './profiles/ducati-panigale-v4.json';
import yamahaR1 from './profiles/yamaha-r1.json';
import harleyDavidson from './profiles/harley-davidson-vtwin.json';

export interface ProfileGroup {
  label: string;
  profiles: EngineProfile[];
}

const profileGroups: ProfileGroup[] = [
  {
    label: 'Cars',
    profiles: [
      hondaK20a as EngineProfile,
      toyota2grfe as EngineProfile,
      fordCoyote as EngineProfile,
      bmwB58 as EngineProfile,
      ferrariF136 as EngineProfile,
      vw20tdi as EngineProfile,
    ],
  },
  {
    label: 'Supercars',
    profiles: [
      bugattiChiron as EngineProfile,
      bugattiChironSs300 as EngineProfile,
      lamborghiniAventador as EngineProfile,
      porsche911gt3 as EngineProfile,
    ],
  },
  {
    label: 'Record / F1',
    profiles: [
      f1V6Turbo as EngineProfile,
    ],
  },
  {
    label: 'Motos',
    profiles: [
      ducatiPanigaleV4 as EngineProfile,
      yamahaR1 as EngineProfile,
      harleyDavidson as EngineProfile,
    ],
  },
];

export function getProfileGroups(): ProfileGroup[] {
  return profileGroups;
}

export function getAllProfiles(): EngineProfile[] {
  return profileGroups.flatMap((g) => g.profiles);
}

export function getProfileById(id: string): EngineProfile | undefined {
  return getAllProfiles().find((p) => p.id === id);
}

export function getDefaultProfile(): EngineProfile {
  return profileGroups[0].profiles[0];
}
