import type { OMMJsonObject } from 'satellite.js';

export type SatelliteOmm = OMMJsonObject;

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
}

export interface PropagatedSatelliteState {
  eciPositionKm: CartesianVector;
  eciVelocityKmS: CartesianVector;
  ecfPositionKm: CartesianVector;
  worldPosition: CartesianVector;
  gmstRadians: number;
  telemetry: SatelliteTelemetry;
}
