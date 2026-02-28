export type EngineType =
  | 'inline-4'
  | 'inline-6'
  | 'v6'
  | 'v8-crossplane'
  | 'v8-flatplane'
  | 'v-twin'
  | 'v4'
  | 'w16'
  | 'v12'
  | 'flat-6';

export type Aspiration = 'na' | 'turbo' | 'turbo-diesel';
export type ExhaustType = 'stock' | 'sport' | 'straight-pipe';
export type TransmissionMode = 'manual' | 'automatic';
export type DriveType = 'fwd' | 'rwd' | 'awd';
export type InputMode = 'keyboard' | 'ev-augmented';

export interface TurboConfig {
  maxBoostBar: number;
  spoolTimeSec: number;
  boostThresholdRPM: number;
  hasBOV: boolean;
}

export interface HarmonicProfile {
  numHarmonics: number;
  spectralRolloff: number;
  firingHarmonicBoost: number;
  loadBrightness: number;
}

export interface ExhaustResonance {
  freq: number;
  Q: number;
  gainDB: number;
}

export interface ExhaustConfig {
  type: ExhaustType;
  lowpassBaseFreq: number;
  lowpassRpmScale: number;
  lowpassQ: number;
  resonances: ExhaustResonance[];
}

export interface EngineProfile {
  id: string;
  name: string;
  type: EngineType;
  displacement: number;
  cylinders: number;
  aspiration: Aspiration;
  idleRPM: number;
  redlineRPM: number;
  peakTorque: number;
  peakTorqueRPM: number;
  peakPower: number;
  peakPowerRPM: number;
  torqueCurve: [number, number][];
  firingOrder: number[];
  gearRatios: number[];
  finalDrive: number;
  wheelRadius: number;
  exhaustConfig: ExhaustConfig;
  harmonicProfile: HarmonicProfile;
  turbo?: TurboConfig;
  driveType?: DriveType;
  vehicleMass: number;
  dragCoefficient: number;
  frontalArea: number;
  rollingResistance: number;
  imageUrl?: string;
}

export interface EngineState {
  rpm: number;
  throttle: number;
  brake: number;
  gear: number;
  speedMs: number;
  speedKmh: number;
  accelerationMs2: number;
  accelerationG: number;
  torqueNm: number;
  powerKw: number;
  powerHp: number;
  boostBar: number;
  isShifting: boolean;
  transmissionMode: TransmissionMode;
  revLimiterActive: boolean;
  wheelSlip: number;
  launchControlActive: boolean;
}
