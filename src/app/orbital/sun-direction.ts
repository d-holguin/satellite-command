import { eciToEcf, gstime } from 'satellite.js';
import { CartesianVector } from '../models/satellite.model';

const JULIAN_UNIX_EPOCH = 2_440_587.5;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Returns an Earth-fixed unit vector pointing from Earth toward the Sun.
 * The compact solar ephemeris is sufficient for a plausible visual terminator.
 */
export function sunDirectionEarthFixed(timestamp: Date): CartesianVector {
  const julianDate = timestamp.getTime() / MILLISECONDS_PER_DAY + JULIAN_UNIX_EPOCH;
  const daysSinceJ2000 = julianDate - 2_451_545;
  const meanLongitude = degreesToRadians(normalizeDegrees(280.46 + 0.9856474 * daysSinceJ2000));
  const meanAnomaly = degreesToRadians(normalizeDegrees(357.528 + 0.9856003 * daysSinceJ2000));
  const eclipticLongitude =
    meanLongitude +
    degreesToRadians(1.915) * Math.sin(meanAnomaly) +
    degreesToRadians(0.02) * Math.sin(2 * meanAnomaly);
  const obliquity = degreesToRadians(23.439 - 0.0000004 * daysSinceJ2000);

  const sunEci = {
    x: Math.cos(eclipticLongitude),
    y: Math.cos(obliquity) * Math.sin(eclipticLongitude),
    z: Math.sin(obliquity) * Math.sin(eclipticLongitude),
  };
  const sunEcf = eciToEcf(sunEci, gstime(timestamp));
  return { x: sunEcf.x, y: sunEcf.z, z: -sunEcf.y };
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}
