import { ecfToLookAngles, geodeticToEcf } from 'satellite.js';
import type { EcfVec3, GeodeticLocation, Kilometer } from 'satellite.js';
import { ElevationTrend, ObserverLocation, ObserverSatelliteLook } from '../models/observer.model';
import { CartesianVector } from '../models/satellite.model';
import { EARTH_EQUATORIAL_RADIUS_KM, latLonToWorldPosition } from './coordinate-converter';

const RADIANS_TO_DEGREES = 180 / Math.PI;

export function observerLocationToGeodetic(location: ObserverLocation): GeodeticLocation {
  return {
    latitude: (location.latitudeDeg * Math.PI) / 180,
    longitude: (location.longitudeDeg * Math.PI) / 180,
    height: location.altitudeKm,
  };
}

export function observerLocationToEcf(location: ObserverLocation): CartesianVector {
  return geodeticToEcf(observerLocationToGeodetic(location));
}

export function observerLocationToWorldPosition(
  location: ObserverLocation,
  surfaceOffset = 0,
): CartesianVector {
  return latLonToWorldPosition(
    location.latitudeDeg,
    location.longitudeDeg,
    1 + location.altitudeKm / EARTH_EQUATORIAL_RADIUS_KM + surfaceOffset,
  );
}

export function lookAnglesFromEcf(
  observer: ObserverLocation,
  satelliteEcf: EcfVec3<Kilometer>,
  index: number,
): ObserverSatelliteLook {
  const look = ecfToLookAngles(observerLocationToGeodetic(observer), satelliteEcf);
  return {
    index,
    azimuthDeg: normalizeDegrees(look.azimuth * RADIANS_TO_DEGREES),
    elevationDeg: look.elevation * RADIANS_TO_DEGREES,
    rangeKm: look.rangeSat,
  };
}

export function isAboveHorizon(elevationDeg: number): boolean {
  return elevationDeg > 0;
}

export function azimuthToCardinal(azimuthDeg: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  return directions[Math.round(normalizeDegrees(azimuthDeg) / 45) % directions.length];
}

export function elevationTrend(previousDeg: number, nextDeg: number): ElevationTrend {
  const difference = nextDeg - previousDeg;
  if (Math.abs(difference) < 0.08) return 'NEAR MAX';
  return difference > 0 ? 'RISING' : 'SETTING';
}

export function skyRadarPosition(
  azimuthDeg: number,
  elevationDeg: number,
): { x: number; y: number } {
  const azimuth = (normalizeDegrees(azimuthDeg) * Math.PI) / 180;
  const radius = Math.max(0, Math.min(1, 1 - elevationDeg / 90));
  return {
    x: Math.sin(azimuth) * radius,
    y: -Math.cos(azimuth) * radius,
  };
}

export function visibilityFootprintCentralAngle(altitudeKm: number, earthRadiusKm: number): number {
  if (altitudeKm < 0 || earthRadiusKm <= 0) {
    throw new Error('Footprint geometry requires positive radius and non-negative altitude.');
  }
  return Math.acos(earthRadiusKm / (earthRadiusKm + altitudeKm));
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
