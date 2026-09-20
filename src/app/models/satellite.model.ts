import type { OMMJsonObject } from 'satellite.js';

export type SatelliteOmm = OMMJsonObject;

export const SATELLITE_CATEGORIES = [
  'STARLINK',
  'STATIONS',
  'WEATHER',
  'GPS',
  'GALILEO',
  'GEO',
  'OTHER',
] as const;

export type SatelliteCategory = (typeof SATELLITE_CATEGORIES)[number];
export type SatelliteFilter = 'ALL' | SatelliteCategory;

export interface SatelliteRecord {
  name: string;
  noradId: number;
  objectId: string;
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argPericenter: number;
  meanAnomaly: number;
  elementSetNo: number;
  revAtEpoch: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
  categories: SatelliteCategory[];
}

export interface SatelliteCatalog {
  version: 1;
  generatedAt: string;
  source: string;
  satellites: SatelliteRecord[];
}

export interface SatelliteSearchResult {
  index: number;
  satellite: SatelliteRecord;
}

export interface CartesianVector {
  x: number;
  y: number;
  z: number;
}

export interface SatelliteTelemetry {
  name: string;
  noradId: number;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  velocityKmS: number;
  timestamp: Date;
  elementEpoch: Date;
  inclinationDeg: number;
  categories: SatelliteCategory[];
}

export interface PropagatedSatelliteState {
  eciPositionKm: CartesianVector;
  eciVelocityKmS: CartesianVector;
  ecfPositionKm: CartesianVector;
  worldPosition: CartesianVector;
  gmstRadians: number;
  telemetry: SatelliteTelemetry;
}
