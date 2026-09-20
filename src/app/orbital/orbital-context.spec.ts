import { EARTH_EQUATORIAL_RADIUS_KM } from './coordinate-converter';
import {
  altitudeFromWorldPosition,
  calculateOrbitalMetrics,
  projectWorldPositionToEarth,
} from './orbital-context';

describe('orbital context', () => {
  it('derives altitude from the normalized Earth radius', () => {
    expect(altitudeFromWorldPosition({ x: 1.1, y: 0, z: 0 })).toBeCloseTo(
      EARTH_EQUATORIAL_RADIUS_KM * 0.1,
      8,
    );
  });

  it('projects a satellite direction just above the Earth surface', () => {
    const projected = projectWorldPositionToEarth({ x: 2, y: -3, z: 6 }, 1.004);
    expect(Math.hypot(projected.x, projected.y, projected.z)).toBeCloseTo(1.004, 12);
  });

  it('derives plausible ISS period, perigee, and apogee from OMM elements', () => {
    const metrics = calculateOrbitalMetrics({ meanMotion: 15.49, eccentricity: 0.00048 });
    expect(metrics.periodMinutes).toBeGreaterThan(92);
    expect(metrics.periodMinutes).toBeLessThan(94);
    expect(metrics.perigeeKm).toBeGreaterThan(350);
    expect(metrics.apogeeKm).toBeLessThan(500);
  });
});
