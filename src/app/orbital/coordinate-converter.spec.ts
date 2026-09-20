import {
  EARTH_EQUATORIAL_RADIUS_KM,
  ecfKilometersToWorldPosition,
  latLonToWorldPosition,
  vectorMagnitude,
  worldPositionToLatLon,
} from './coordinate-converter';

describe('coordinate conversion', () => {
  it('normalizes ECF kilometers and maps north to Three.js +Y', () => {
    const worldPosition = ecfKilometersToWorldPosition({
      x: EARTH_EQUATORIAL_RADIUS_KM,
      y: EARTH_EQUATORIAL_RADIUS_KM * 2,
      z: EARTH_EQUATORIAL_RADIUS_KM * 3,
    });

    expect(worldPosition).toEqual({ x: 1, y: 3, z: -2 });
  });

  it('normalizes the equatorial Earth surface to one world unit', () => {
    const worldPosition = ecfKilometersToWorldPosition({
      x: EARTH_EQUATORIAL_RADIUS_KM,
      y: 0,
      z: 0,
    });

    expect(vectorMagnitude(worldPosition)).toBeCloseTo(1, 12);
  });

  it('calculates three-dimensional velocity magnitude', () => {
    expect(vectorMagnitude({ x: 3, y: 4, z: 12 })).toBe(13);
  });

  it('maps the equator and prime meridian to Three.js +X', () => {
    const position = latLonToWorldPosition(0, 0);

    expect(position.x).toBeCloseTo(1, 12);
    expect(position.y).toBeCloseTo(0, 12);
    expect(position.z).toBeCloseTo(0, 12);
  });

  it('maps east longitude toward Three.js -Z', () => {
    const position = latLonToWorldPosition(0, 90);

    expect(position.x).toBeCloseTo(0, 12);
    expect(position.y).toBeCloseTo(0, 12);
    expect(position.z).toBeCloseTo(-1, 12);
  });

  it('maps the geographic north pole to Three.js +Y', () => {
    const position = latLonToWorldPosition(90, 0, 1.25);

    expect(position.x).toBeCloseTo(0, 12);
    expect(position.y).toBeCloseTo(1.25, 12);
    expect(position.z).toBeCloseTo(0, 12);
  });

  it.each([
    { name: 'Greenwich', latitudeDeg: 51.4779, longitudeDeg: 0 },
    { name: 'New York', latitudeDeg: 40.7, longitudeDeg: -74 },
    { name: 'Tokyo', latitudeDeg: 35.7, longitudeDeg: 139.7 },
    { name: 'Sydney', latitudeDeg: -33.9, longitudeDeg: 151.2 },
  ])('round-trips $name through Earth-fixed world space', ({ latitudeDeg, longitudeDeg }) => {
    const position = latLonToWorldPosition(latitudeDeg, longitudeDeg);
    const coordinates = worldPositionToLatLon(position);

    expect(coordinates.latitudeDeg).toBeCloseTo(latitudeDeg, 10);
    expect(coordinates.longitudeDeg).toBeCloseTo(longitudeDeg, 10);
  });

  it('rejects the Earth center because it has no geographic coordinate', () => {
    expect(() => worldPositionToLatLon({ x: 0, y: 0, z: 0 })).toThrowError(
      'Cannot derive geographic coordinates from the Earth center.',
    );
  });
});
