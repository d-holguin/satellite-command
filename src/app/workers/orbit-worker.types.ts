import type { SatelliteCategory, SatelliteRecord } from '../models/satellite.model';

export interface WorkerSatelliteTelemetry {
  index: number;
  name: string;
  noradId: number;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  velocityKmS: number;
  timestampMs: number;
  elementEpoch: string;
  inclinationDeg: number;
  categories: SatelliteCategory[];
}

export type OrbitWorkerRequest =
  | { type: 'initialize'; records: SatelliteRecord[] }
  | { type: 'propagate'; timestampMs: number; positionsBuffer?: ArrayBuffer }
  | { type: 'select'; index: number | null }
  | { type: 'orbit'; index: number; timestampMs: number };

export type OrbitWorkerResponse =
  | { type: 'ready'; initializedCount: number; rejectedCount: number }
  | {
      type: 'frame';
      positionsBuffer: ArrayBuffer;
      selectedTelemetry: WorkerSatelliteTelemetry | null;
      failedCount: number;
      calculationMs: number;
    }
  | { type: 'orbit'; index: number; positionsBuffer: ArrayBuffer }
  | { type: 'error'; message: string };
