import type { EngineProfile } from './types';

export function interpolateTorque(
  rpm: number,
  torqueCurve: [number, number][],
): number {
  if (torqueCurve.length === 0) return 0;
  if (rpm <= torqueCurve[0][0]) return torqueCurve[0][1];
  if (rpm >= torqueCurve[torqueCurve.length - 1][0]) {
    return torqueCurve[torqueCurve.length - 1][1];
  }

  for (let i = 0; i < torqueCurve.length - 1; i++) {
    const [rpmLow, tLow] = torqueCurve[i];
    const [rpmHigh, tHigh] = torqueCurve[i + 1];
    if (rpm >= rpmLow && rpm <= rpmHigh) {
      const t = (rpm - rpmLow) / (rpmHigh - rpmLow);
      return tLow + t * (tHigh - tLow);
    }
  }
  return torqueCurve[torqueCurve.length - 1][1];
}

export function getEngineTorque(
  rpm: number,
  throttle: number,
  profile: EngineProfile,
): number {
  const maxTorque = interpolateTorque(rpm, profile.torqueCurve);
  return maxTorque * Math.pow(Math.max(0, throttle), 1.5);
}

export function computePower(
  torqueNm: number,
  rpm: number,
): { kw: number; hp: number } {
  const watts = torqueNm * rpm * ((2 * Math.PI) / 60);
  const kw = watts / 1000;
  return { kw, hp: kw * 1.341 };
}

export function clampRPM(rpm: number, profile: EngineProfile): number {
  return Math.max(profile.idleRPM, Math.min(rpm, profile.redlineRPM));
}

// --- Rev Limiter ---
const REV_LIMITER_CUT_FREQ = 15; // Hz

export interface RevLimiterResult {
  torqueMultiplier: number;
  newPhase: number;
  popTriggered: boolean;
}

export function applyRevLimiter(
  rpm: number,
  profile: EngineProfile,
  phase: number,
  dt: number,
): RevLimiterResult {
  if (rpm < profile.redlineRPM - 100) {
    return { torqueMultiplier: 1.0, newPhase: 0, popTriggered: false };
  }
  // Oscillating fuel cut near/at redline
  const newPhase = (phase + dt * REV_LIMITER_CUT_FREQ) % 1.0;
  const cutting = newPhase < 0.5; // 50% duty cycle
  const popTriggered = cutting && phase >= 0.5; // rising edge of cut
  return {
    torqueMultiplier: cutting ? 0.05 : 0.7,
    newPhase,
    popTriggered,
  };
}
