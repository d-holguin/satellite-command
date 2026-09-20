import { CartesianVector } from '../models/satellite.model';
import { GeographicCoordinates } from '../models/geography.model';

export const EARTH_EQUATORIAL_RADIUS_KM = 6_378.137;

/**
 * Maps Earth-centered, Earth-fixed kilometers into the globe's world space.
 * ECF +Z is north; Three.js uses +Y as north, with -ECF Y mapped to Three Z.
 */
export function ecfKilometersToWorldPosition(
  ecfPositionKm: Readonly<CartesianVector>,
): CartesianVector {
  return {
    x: ecfPositionKm.x / EARTH_EQUATORIAL_RADIUS_KM,
    y: ecfPositionKm.z / EARTH_EQUATORIAL_RADIUS_KM,
    z: -ecfPositionKm.y / EARTH_EQUATORIAL_RADIUS_KM,
  };
}

export function vectorMagnitude(vector: Readonly<CartesianVector>): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

/** Converts latitude/longitude to the same +Y-north world frame as ECF data. */
export function latLonToWorldPosition(
  latitudeDeg: number,
  longitudeDeg: number,
  radius = 1,
): CartesianVector {
  const latitude = (latitudeDeg * Math.PI) / 180;
  const longitude = (longitudeDeg * Math.PI) / 180;
  const equatorialRadius = radius * Math.cos(latitude);

  return {
    x: equatorialRadius * Math.cos(longitude),
    y: radius * Math.sin(latitude),
    z: -equatorialRadius * Math.sin(longitude),
  };
}

/** Converts a world-space surface point back into Earth-fixed coordinates. */
export function worldPositionToLatLon(position: Readonly<CartesianVector>): GeographicCoordinates {
  const radius = vectorMagnitude(position);

  if (radius === 0) {
    throw new Error('Cannot derive geographic coordinates from the Earth center.');
  }

  return {
    latitudeDeg: (Math.asin(position.y / radius) * 180) / Math.PI,
    longitudeDeg: (Math.atan2(-position.z, position.x) * 180) / Math.PI,
  };
}
