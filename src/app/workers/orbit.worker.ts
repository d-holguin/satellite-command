/// <reference lib="webworker" />

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
import type { OMMJsonObject } from 'satellite.js';
import { SatelliteRecord } from '../models/satellite.model';
import { EARTH_EQUATORIAL_RADIUS_KM } from '../orbital/coordinate-converter';
import {
  OrbitWorkerRequest,
  OrbitWorkerResponse,
  WorkerSatelliteTelemetry,
} from './orbit-worker.types';

const ORBIT_SAMPLE_COUNT = 181;
const scope = self as DedicatedWorkerGlobalScope;

let records: SatelliteRecord[] = [];
let satrecs: Array<SatRec | null> = [];
let selectedIndex: number | null = null;

scope.addEventListener('message', ({ data }: MessageEvent<OrbitWorkerRequest>) => {
  try {
    switch (data.type) {
      case 'initialize':
        initialize(data.records);
        break;
      case 'propagate':
        propagateCatalog(data.timestampMs, data.positionsBuffer);
        break;
      case 'select':
        selectedIndex = data.index;
        break;
      case 'orbit':
        calculateOrbit(data.index, data.timestampMs);
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});

function initialize(nextRecords: SatelliteRecord[]): void {
  records = nextRecords;
  let initializedCount = 0;
  satrecs = records.map((record) => {
    try {
      const satrec = json2satrec(toOmm(record));
      if (satrec.error !== SatRecError.None) return null;
      initializedCount += 1;
      return satrec;
    } catch {
      return null;
    }
  });

  post({
    type: 'ready',
    initializedCount,
    rejectedCount: records.length - initializedCount,
  });
}

function propagateCatalog(timestampMs: number, reusableBuffer?: ArrayBuffer): void {
  const startedAt = performance.now();
  const requiredBytes = records.length * 3 * Float32Array.BYTES_PER_ELEMENT;
  const positions =
    reusableBuffer?.byteLength === requiredBytes
      ? new Float32Array(reusableBuffer)
      : new Float32Array(records.length * 3);
  const timestamp = new Date(timestampMs);
  const gmstRadians = gstime(timestamp);
  let failedCount = 0;
  let selectedTelemetry: WorkerSatelliteTelemetry | null = null;

  for (let index = 0; index < satrecs.length; index += 1) {
    const satrec = satrecs[index];
    const offset = index * 3;
    if (!satrec) {
      setInvalidPosition(positions, offset);
      failedCount += 1;
      continue;
    }

    const result = propagate(satrec, timestamp);
    if (!result || satrec.error !== SatRecError.None) {
      setInvalidPosition(positions, offset);
      failedCount += 1;
      continue;
    }

    const ecf = eciToEcf(result.position, gmstRadians);
    positions[offset] = ecf.x / EARTH_EQUATORIAL_RADIUS_KM;
    positions[offset + 1] = ecf.z / EARTH_EQUATORIAL_RADIUS_KM;
    positions[offset + 2] = -ecf.y / EARTH_EQUATORIAL_RADIUS_KM;

    if (index === selectedIndex) {
      const geodetic = eciToGeodetic(result.position, gmstRadians);
      const record = records[index];
      selectedTelemetry = {
        index,
        name: record.name,
        noradId: record.noradId,
        latitudeDeg: degreesLat(geodetic.latitude),
        longitudeDeg: degreesLong(geodetic.longitude),
        altitudeKm: geodetic.height,
        velocityKmS: Math.hypot(result.velocity.x, result.velocity.y, result.velocity.z),
        timestampMs,
        elementEpoch: record.epoch,
        inclinationDeg: record.inclination,
        categories: record.categories,
      };
    }
  }

  post(
    {
      type: 'frame',
      positionsBuffer: positions.buffer,
      selectedTelemetry,
      failedCount,
      calculationMs: performance.now() - startedAt,
    },
    [positions.buffer],
  );
}

function calculateOrbit(index: number, timestampMs: number): void {
  const satrec = satrecs[index];
  const record = records[index];
  if (!satrec || !record) {
    const emptyPath = new Float32Array();
    post({ type: 'orbit', index, positionsBuffer: emptyPath.buffer }, [emptyPath.buffer]);
    return;
  }

  const periodMs = 86_400_000 / record.meanMotion;
  const positions: number[] = [];
  for (let sample = 0; sample < ORBIT_SAMPLE_COUNT; sample += 1) {
    const progress = sample / (ORBIT_SAMPLE_COUNT - 1) - 0.5;
    const timestamp = new Date(timestampMs + periodMs * progress);
    const result = propagate(satrec, timestamp);
    if (!result || satrec.error !== SatRecError.None) continue;

    const ecf = eciToEcf(result.position, gstime(timestamp));
    positions.push(
      ecf.x / EARTH_EQUATORIAL_RADIUS_KM,
      ecf.z / EARTH_EQUATORIAL_RADIUS_KM,
      -ecf.y / EARTH_EQUATORIAL_RADIUS_KM,
    );
  }

  const path = new Float32Array(positions);
  post({ type: 'orbit', index, positionsBuffer: path.buffer }, [path.buffer]);
}

function toOmm(record: SatelliteRecord): OMMJsonObject {
  return {
    OBJECT_NAME: record.name,
    OBJECT_ID: record.objectId,
    EPOCH: record.epoch,
    MEAN_MOTION: record.meanMotion,
    ECCENTRICITY: record.eccentricity,
    INCLINATION: record.inclination,
    RA_OF_ASC_NODE: record.raan,
    ARG_OF_PERICENTER: record.argPericenter,
    MEAN_ANOMALY: record.meanAnomaly,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: record.noradId,
    ELEMENT_SET_NO: record.elementSetNo,
    REV_AT_EPOCH: record.revAtEpoch,
    BSTAR: record.bstar,
    MEAN_MOTION_DOT: record.meanMotionDot,
    MEAN_MOTION_DDOT: record.meanMotionDdot,
  };
}

function setInvalidPosition(positions: Float32Array, offset: number): void {
  positions[offset] = Number.NaN;
  positions[offset + 1] = Number.NaN;
  positions[offset + 2] = Number.NaN;
}

function post(message: OrbitWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}
