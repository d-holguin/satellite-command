import { geodeticToEcf } from 'satellite.js';
import { EARTH_EQUATORIAL_RADIUS_KM } from './coordinate-converter';
import {
  azimuthToCardinal,
  elevationTrend,
  isAboveHorizon,
  lookAnglesFromEcf,
  observerLocationToGeodetic,
  observerLocationToWorldPosition,
  skyRadarPosition,
  visibilityFootprintCentralAngle,
} from './observer-geometry';

const OBSERVER = { latitudeDeg: 33.4484, longitudeDeg: -112.074, altitudeKm: 0 };

describe('observer geometry', () => {
  it('converts observer degrees to the radians and kilometers satellite.js expects', () => {
    const geodetic = observerLocationToGeodetic(OBSERVER);
    expect(geodetic.latitude).toBeCloseTo((33.4484 * Math.PI) / 180, 12);
    expect(geodetic.longitude).toBeCloseTo((-112.074 * Math.PI) / 180, 12);
    expect(geodetic.height).toBe(0);
  });

  it('calculates an overhead satellite as above the horizon', () => {
    const observerEcf = geodeticToEcf(observerLocationToGeodetic(OBSERVER));
    const scale = (EARTH_EQUATORIAL_RADIUS_KM + 500) / EARTH_EQUATORIAL_RADIUS_KM;
    const look = lookAnglesFromEcf(
      OBSERVER,
      { x: observerEcf.x * scale, y: observerEcf.y * scale, z: observerEcf.z * scale },
      7,
    );
    expect(look.index).toBe(7);
    expect(look.elevationDeg).toBeGreaterThan(89);
    expect(isAboveHorizon(look.elevationDeg)).toBe(true);
  });

  it('maps observer altitude into the normalized +Y-north world frame', () => {
    const position = observerLocationToWorldPosition({
      latitudeDeg: 90,
      longitudeDeg: 0,
      altitudeKm: 1,
    });
    expect(position.y).toBeCloseTo(1 + 1 / EARTH_EQUATORIAL_RADIUS_KM, 12);
    expect(position.x).toBeCloseTo(0, 12);
    expect(position.z).toBeCloseTo(0, 12);
  });

  it.each([
    [0, 'N'],
    [45, 'NE'],
    [90, 'E'],
    [180, 'S'],
    [225, 'SW'],
    [315, 'NW'],
  ] as const)('maps azimuth %s° to %s', (azimuth, cardinal) => {
    expect(azimuthToCardinal(azimuth)).toBe(cardinal);
  });

  it('uses elevation greater than zero as the canonical horizon test', () => {
    expect(isAboveHorizon(0.001)).toBe(true);
    expect(isAboveHorizon(0)).toBe(false);
    expect(isAboveHorizon(-0.001)).toBe(false);
  });

  it('derives rising, setting, and near-maximum states from elevation change', () => {
    expect(elevationTrend(10, 11)).toBe('RISING');
    expect(elevationTrend(11, 10)).toBe('SETTING');
    expect(elevationTrend(10, 10.01)).toBe('NEAR MAX');
  });

  it('maps north at the horizon to the top of the sky radar and zenith to center', () => {
    expect(skyRadarPosition(0, 0)).toEqual({ x: 0, y: -1 });
    expect(skyRadarPosition(90, 0).x).toBeCloseTo(1, 12);
    expect(skyRadarPosition(90, 0).y).toBeCloseTo(0, 12);
    expect(skyRadarPosition(123, 90)).toEqual({ x: 0, y: 0 });
  });

  it('produces physically larger footprints at GEO than LEO', () => {
    const leo = visibilityFootprintCentralAngle(500, EARTH_EQUATORIAL_RADIUS_KM);
    const geo = visibilityFootprintCentralAngle(35_786, EARTH_EQUATORIAL_RADIUS_KM);
    expect(leo).toBeGreaterThan(0);
    expect(geo).toBeGreaterThan(leo * 2);
    expect(geo).toBeLessThan(Math.PI / 2);
  });
});
