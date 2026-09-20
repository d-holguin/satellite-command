import { OrbitalMetrics, SatelliteRecord } from '../models/satellite.model';
import { CartesianVector } from '../models/satellite.model';
import { EARTH_EQUATORIAL_RADIUS_KM, vectorMagnitude } from './coordinate-converter';

const EARTH_GRAVITATIONAL_PARAMETER_KM3_S2 = 398_600.4418;

export function altitudeFromWorldPosition(position: Readonly<CartesianVector>): number {
  return (vectorMagnitude(position) - 1) * EARTH_EQUATORIAL_RADIUS_KM;
}

export function projectWorldPositionToEarth(
  position: Readonly<CartesianVector>,
  radius = 1.003,
): CartesianVector {
  const magnitude = vectorMagnitude(position);
  if (magnitude === 0) throw new Error('Cannot project the Earth center onto its surface.');
  const scale = radius / magnitude;
  return { x: position.x * scale, y: position.y * scale, z: position.z * scale };
}

export function calculateOrbitalMetrics(
  record: Pick<SatelliteRecord, 'meanMotion' | 'eccentricity'>,
): OrbitalMetrics {
  const periodSeconds = 86_400 / record.meanMotion;
  const angularRateRadiansPerSecond = (Math.PI * 2) / periodSeconds;
  const semiMajorAxisKm = Math.cbrt(
    EARTH_GRAVITATIONAL_PARAMETER_KM3_S2 /
      (angularRateRadiansPerSecond * angularRateRadiansPerSecond),
  );

  return {
    periodMinutes: periodSeconds / 60,
    perigeeKm: semiMajorAxisKm * (1 - record.eccentricity) - EARTH_EQUATORIAL_RADIUS_KM,
    apogeeKm: semiMajorAxisKm * (1 + record.eccentricity) - EARTH_EQUATORIAL_RADIUS_KM,
  };
}
