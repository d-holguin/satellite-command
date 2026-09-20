/// <reference lib="webworker" />

import {
  SatRec,
  SatRecError,
  degreesLat,
  degreesLong,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
} from 'satellite.js';
import type { GeodeticLocation, OMMJsonObject } from 'satellite.js';
import { ObserverLocation } from '../models/observer.model';
import { SatelliteRecord } from '../models/satellite.model';
import { EARTH_EQUATORIAL_RADIUS_KM } from '../orbital/coordinate-converter';
import { observerLocationToGeodetic } from '../orbital/observer-geometry';
import { projectWorldPositionToEarth } from '../orbital/orbital-context';
import { predictPassFromElevation } from '../orbital/pass-predictor';
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
let observerGeodetic: GeodeticLocation | null = null;

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
      case 'observer':
        setObserver(data.location);
        break;
      case 'predict-pass':
        calculatePass(data.index, data.timestampMs);
        break;
      case 'trajectory':
        calculateTrajectory(data.index, data.timestampMs);
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
  let selectedObserverLook: import('./orbit-worker.types').WorkerSelectedObserverLook | null = null;
  const aboveHorizon: number[] = [];

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

    if (observerGeodetic) {
      const look = ecfToLookAngles(observerGeodetic, ecf);
      if (look.elevation > 0) {
        aboveHorizon.push(index, look.azimuth, look.elevation, look.rangeSat);
      }
      if (index === selectedIndex) {
        selectedObserverLook = {
          index,
          azimuthRad: look.azimuth,
          elevationRad: look.elevation,
          rangeKm: look.rangeSat,
          trend: calculateElevationTrend(satrec, timestampMs, observerGeodetic),
        };
      }
    }

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

  const observerData = new Float32Array(aboveHorizon);
  post(
    {
      type: 'frame',
      positionsBuffer: positions.buffer,
      observerBuffer: observerData.buffer,
      selectedTelemetry,
      selectedObserverLook,
      failedCount,
      calculationMs: performance.now() - startedAt,
    },
    [positions.buffer, observerData.buffer],
  );
}

function setObserver(location: ObserverLocation | null): void {
  observerGeodetic = location ? observerLocationToGeodetic(location) : null;
}

function calculateElevationTrend(
  satrec: SatRec,
  timestampMs: number,
  observer: GeodeticLocation,
): 'RISING' | 'SETTING' | 'NEAR MAX' {
  const before = elevationAt(satrec, timestampMs - 30_000, observer);
  const after = elevationAt(satrec, timestampMs + 30_000, observer);
  if (before === null || after === null || Math.abs(after - before) < 0.0014) return 'NEAR MAX';
  return after > before ? 'RISING' : 'SETTING';
}

function calculatePass(index: number, timestampMs: number): void {
  const satrec = satrecs[index];
  if (!satrec || !observerGeodetic) {
    post({
      type: 'pass',
      prediction: {
        index,
        status: 'NONE',
        riseTimeMs: null,
        maxElevationTimeMs: null,
        maxElevationDeg: null,
        setTimeMs: null,
      },
    });
    return;
  }

  const result = predictPassFromElevation(timestampMs, (sampleTimeMs) => {
    const elevation = elevationAt(satrec, sampleTimeMs, observerGeodetic!);
    return elevation === null ? null : (elevation * 180) / Math.PI;
  });
  post({ type: 'pass', prediction: { index, ...result } });
}

function elevationAt(
  satrec: SatRec,
  timestampMs: number,
  observer: GeodeticLocation,
): number | null {
  const timestamp = new Date(timestampMs);
  const result = propagate(satrec, timestamp);
  if (!result || satrec.error !== SatRecError.None) return null;
  const ecf = eciToEcf(result.position, gstime(timestamp));
  return ecfToLookAngles(observer, ecf).elevation;
}

function calculateTrajectory(index: number, timestampMs: number): void {
  const satrec = satrecs[index];
  const record = records[index];
  if (!satrec || !record) {
    const emptyOrbit = new Float32Array();
    const emptyGroundTrack = new Float32Array();
    post(
      {
        type: 'trajectory',
        index,
        orbitPositionsBuffer: emptyOrbit.buffer,
        groundTrackPositionsBuffer: emptyGroundTrack.buffer,
      },
      [emptyOrbit.buffer, emptyGroundTrack.buffer],
    );
    return;
  }

  const periodMs = 86_400_000 / record.meanMotion;
  const orbitPositions: number[] = [];
  const groundTrackPositions: number[] = [];
  for (let sample = 0; sample < ORBIT_SAMPLE_COUNT; sample += 1) {
    const progress = sample / (ORBIT_SAMPLE_COUNT - 1) - 0.5;
    const timestamp = new Date(timestampMs + periodMs * progress);
    const result = propagate(satrec, timestamp);
    if (!result || satrec.error !== SatRecError.None) continue;

    const ecf = eciToEcf(result.position, gstime(timestamp));
    const worldX = ecf.x / EARTH_EQUATORIAL_RADIUS_KM;
    const worldY = ecf.z / EARTH_EQUATORIAL_RADIUS_KM;
    const worldZ = -ecf.y / EARTH_EQUATORIAL_RADIUS_KM;
    orbitPositions.push(worldX, worldY, worldZ);

    const ground = projectWorldPositionToEarth({ x: worldX, y: worldY, z: worldZ });
    groundTrackPositions.push(ground.x, ground.y, ground.z);
  }

  const orbitPath = new Float32Array(orbitPositions);
  const groundTrackPath = new Float32Array(groundTrackPositions);
  post(
    {
      type: 'trajectory',
      index,
      orbitPositionsBuffer: orbitPath.buffer,
      groundTrackPositionsBuffer: groundTrackPath.buffer,
    },
    [orbitPath.buffer, groundTrackPath.buffer],
  );
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
