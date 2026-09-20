import type { ElevationTrend, ObserverLocation } from '../models/observer.model';
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

export interface WorkerSelectedObserverLook {
  index: number;
  azimuthRad: number;
  elevationRad: number;
  rangeKm: number;
  trend: ElevationTrend;
}

export interface WorkerPassPrediction {
  index: number;
  status: 'PASS' | 'CONTINUOUS' | 'NONE';
  riseTimeMs: number | null;
  maxElevationTimeMs: number | null;
  maxElevationDeg: number | null;
  setTimeMs: number | null;
}

export type OrbitWorkerRequest =
  | { type: 'initialize'; records: SatelliteRecord[] }
  | { type: 'propagate'; timestampMs: number; positionsBuffer?: ArrayBuffer }
  | { type: 'select'; index: number | null }
  | { type: 'observer'; location: ObserverLocation | null }
  | { type: 'predict-pass'; index: number; timestampMs: number }
  | { type: 'trajectory'; index: number; timestampMs: number };

export type OrbitWorkerResponse =
  | { type: 'ready'; initializedCount: number; rejectedCount: number }
  | {
      type: 'frame';
      positionsBuffer: ArrayBuffer;
      observerBuffer: ArrayBuffer;
      selectedTelemetry: WorkerSatelliteTelemetry | null;
      selectedObserverLook: WorkerSelectedObserverLook | null;
      failedCount: number;
      calculationMs: number;
    }
  | {
      type: 'trajectory';
      index: number;
      orbitPositionsBuffer: ArrayBuffer;
      groundTrackPositionsBuffer: ArrayBuffer;
    }
  | { type: 'pass'; prediction: WorkerPassPrediction }
  | { type: 'error'; message: string };
