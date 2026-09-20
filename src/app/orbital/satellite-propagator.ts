import {
  SatRec,
  SatRecError,
  degreesLat,
  degreesLong,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
} from 'satellite.js';
import { CartesianVector, PropagatedSatelliteState, SatelliteOmm } from '../models/satellite.model';
import { ecfKilometersToWorldPosition, vectorMagnitude } from './coordinate-converter';

export class SatellitePropagator {
  private readonly satrec: SatRec;
  private readonly name: string;
  private readonly noradId: number;
  private readonly elementEpoch: Date;

  constructor(omm: SatelliteOmm) {
    this.name = omm.OBJECT_NAME;
    this.noradId = Number(omm.NORAD_CAT_ID);
    this.elementEpoch = parseOmmEpoch(omm.EPOCH);
    this.satrec = json2satrec(omm);

    if (!Number.isInteger(this.noradId) || this.satrec.error !== SatRecError.None) {
      throw new Error(
        `Could not initialize SGP4 for ${this.name}: ${describeSatrecError(this.satrec.error)}.`,
      );
    }
  }

  propagate(timestamp: Date): PropagatedSatelliteState {
    const result = propagate(this.satrec, timestamp);

    if (result === null || this.satrec.error !== SatRecError.None) {
      throw new Error(
        `SGP4 propagation failed for ${this.name} at ${timestamp.toISOString()}: ${describeSatrecError(this.satrec.error)}.`,
      );
    }

    const gmstRadians = gstime(timestamp);
    const ecfPositionKm = eciToEcf(result.position, gmstRadians);
    const geodetic = eciToGeodetic(result.position, gmstRadians);
    const eciPositionKm = copyVector(result.position);
    const eciVelocityKmS = copyVector(result.velocity);
    const worldPosition = ecfKilometersToWorldPosition(ecfPositionKm);

    assertFiniteVector(eciPositionKm, 'ECI position');
    assertFiniteVector(eciVelocityKmS, 'ECI velocity');
    assertFiniteVector(ecfPositionKm, 'ECF position');
    assertFiniteVector(worldPosition, 'Three.js position');

    const altitudeKm = geodetic.height;
    const latitudeDeg = degreesLat(geodetic.latitude);
    const longitudeDeg = degreesLong(geodetic.longitude);
    const velocityKmS = vectorMagnitude(eciVelocityKmS);

    if (
      !Number.isFinite(altitudeKm) ||
      !Number.isFinite(latitudeDeg) ||
      !Number.isFinite(longitudeDeg) ||
      !Number.isFinite(velocityKmS)
    ) {
      throw new Error(`SGP4 produced invalid telemetry for ${this.name}.`);
    }

    return {
      eciPositionKm,
      eciVelocityKmS,
      ecfPositionKm: copyVector(ecfPositionKm),
      worldPosition,
      gmstRadians,
      telemetry: {
        name: this.name,
        noradId: this.noradId,
        latitudeDeg,
        longitudeDeg,
        altitudeKm,
        velocityKmS,
        timestamp: new Date(timestamp),
        elementEpoch: new Date(this.elementEpoch),
      },
    };
  }
}

function parseOmmEpoch(epoch: string): Date {
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(epoch);
  const parsed = new Date(hasTimeZone ? epoch : `${epoch}Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid OMM epoch: ${epoch}.`);
  }

  return parsed;
}

function copyVector(vector: Readonly<CartesianVector>): CartesianVector {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function assertFiniteVector(vector: CartesianVector, label: string): void {
  if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
    throw new Error(`SGP4 produced an invalid ${label}.`);
  }
}

function describeSatrecError(error: SatRecError): string {
  return SatRecError[error] ?? `unknown error ${error}`;
}
