import {
  ObserverLocation,
  ObserverSatelliteLook,
  SatellitePassPrediction,
  SelectedObserverLook,
} from '../models/observer.model';
import { SatelliteRecord, SatelliteTelemetry } from '../models/satellite.model';
import { azimuthToCardinal } from './observer-geometry';
import {
  OrbitWorkerRequest,
  OrbitWorkerResponse,
  WorkerSatelliteTelemetry,
} from '../workers/orbit-worker.types';

const PROPAGATION_INTERVAL_MS = 200;

export interface OrbitWorkerCallbacks {
  onReady(initializedCount: number, rejectedCount: number): void;
  onFrame(
    positions: Float32Array,
    telemetry: SatelliteTelemetry | null,
    observerSatellites: ObserverSatelliteLook[],
    selectedObserverLook: SelectedObserverLook | null,
    stats: { failedCount: number; calculationMs: number },
  ): void;
  onTrajectory(
    index: number,
    orbitPositions: Float32Array,
    groundTrackPositions: Float32Array,
  ): void;
  onPass(prediction: SatellitePassPrediction): void;
  onError(error: Error): void;
}

export class OrbitWorkerClient {
  private readonly worker = new Worker(new URL('../workers/orbit.worker', import.meta.url), {
    type: 'module',
  });
  private timerId: number | undefined;
  private positionsBuffer: ArrayBuffer | undefined;
  private propagationPending = false;
  private disposed = false;

  constructor(
    private readonly timeProvider: () => Date,
    private readonly callbacks: OrbitWorkerCallbacks,
  ) {
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  initialize(records: SatelliteRecord[]): void {
    this.post({ type: 'initialize', records });
  }

  setSelection(index: number | null): void {
    this.post({ type: 'select', index });
  }

  setObserver(location: ObserverLocation | null): void {
    this.post({ type: 'observer', location });
  }

  requestPass(index: number): number {
    const timestampMs = this.timeProvider().getTime();
    this.post({ type: 'predict-pass', index, timestampMs });
    return timestampMs;
  }

  requestTrajectory(index: number): number {
    const request = createTrajectoryRequest(index, this.timeProvider);
    this.post(request);
    return request.timestampMs;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timerId !== undefined) window.clearInterval(this.timerId);
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerError);
    this.worker.terminate();
    this.positionsBuffer = undefined;
  }

  private start(): void {
    this.requestPropagation();
    this.timerId = window.setInterval(() => this.requestPropagation(), PROPAGATION_INTERVAL_MS);
  }

  private requestPropagation(): void {
    if (this.propagationPending || this.disposed) return;

    this.propagationPending = true;
    const positionsBuffer = this.positionsBuffer;
    this.positionsBuffer = undefined;
    this.post(
      createPropagationRequest(this.timeProvider, positionsBuffer),
      positionsBuffer ? [positionsBuffer] : [],
    );
  }

  private readonly handleMessage = ({ data }: MessageEvent<OrbitWorkerResponse>): void => {
    if (this.disposed) return;

    switch (data.type) {
      case 'ready':
        this.callbacks.onReady(data.initializedCount, data.rejectedCount);
        this.start();
        break;
      case 'frame': {
        const positions = new Float32Array(data.positionsBuffer);
        this.callbacks.onFrame(
          positions,
          toTelemetry(data.selectedTelemetry),
          unpackObserverSatellites(data.observerBuffer),
          toSelectedObserverLook(data.selectedObserverLook),
          {
            failedCount: data.failedCount,
            calculationMs: data.calculationMs,
          },
        );
        this.positionsBuffer = data.positionsBuffer;
        this.propagationPending = false;
        break;
      }
      case 'trajectory':
        this.callbacks.onTrajectory(
          data.index,
          new Float32Array(data.orbitPositionsBuffer),
          new Float32Array(data.groundTrackPositionsBuffer),
        );
        break;
      case 'pass':
        this.callbacks.onPass(toPassPrediction(data.prediction));
        break;
      case 'error':
        this.callbacks.onError(new Error(data.message));
        this.propagationPending = false;
        break;
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.propagationPending = false;
    this.callbacks.onError(new Error(event.message || 'Orbit worker failed.'));
  };

  private post(message: OrbitWorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}

const RADIANS_TO_DEGREES = 180 / Math.PI;

function unpackObserverSatellites(buffer: ArrayBuffer): ObserverSatelliteLook[] {
  const packed = new Float32Array(buffer);
  const satellites: ObserverSatelliteLook[] = [];
  for (let offset = 0; offset + 3 < packed.length; offset += 4) {
    satellites.push({
      index: packed[offset],
      azimuthDeg: packed[offset + 1] * RADIANS_TO_DEGREES,
      elevationDeg: packed[offset + 2] * RADIANS_TO_DEGREES,
      rangeKm: packed[offset + 3],
    });
  }
  return satellites;
}

function toSelectedObserverLook(
  value: import('../workers/orbit-worker.types').WorkerSelectedObserverLook | null,
): SelectedObserverLook | null {
  if (!value) return null;
  const azimuthDeg = value.azimuthRad * RADIANS_TO_DEGREES;
  return {
    index: value.index,
    azimuthDeg,
    elevationDeg: value.elevationRad * RADIANS_TO_DEGREES,
    rangeKm: value.rangeKm,
    direction: azimuthToCardinal(azimuthDeg),
    trend: value.trend,
  };
}

function toPassPrediction(
  value: import('../workers/orbit-worker.types').WorkerPassPrediction,
): SatellitePassPrediction {
  return {
    index: value.index,
    status: value.status,
    riseTime: value.riseTimeMs === null ? null : new Date(value.riseTimeMs),
    maxElevationTime: value.maxElevationTimeMs === null ? null : new Date(value.maxElevationTimeMs),
    maxElevationDeg: value.maxElevationDeg,
    setTime: value.setTimeMs === null ? null : new Date(value.setTimeMs),
  };
}

export function createPropagationRequest(
  timeProvider: () => Date,
  positionsBuffer?: ArrayBuffer,
): Extract<OrbitWorkerRequest, { type: 'propagate' }> {
  return { type: 'propagate', timestampMs: timeProvider().getTime(), positionsBuffer };
}

export function createTrajectoryRequest(
  index: number,
  timeProvider: () => Date,
): Extract<OrbitWorkerRequest, { type: 'trajectory' }> {
  return { type: 'trajectory', index, timestampMs: timeProvider().getTime() };
}

function toTelemetry(value: WorkerSatelliteTelemetry | null): SatelliteTelemetry | null {
  return value
    ? {
        name: value.name,
        noradId: value.noradId,
        latitudeDeg: value.latitudeDeg,
        longitudeDeg: value.longitudeDeg,
        altitudeKm: value.altitudeKm,
        velocityKmS: value.velocityKmS,
        timestamp: new Date(value.timestampMs),
        elementEpoch: new Date(value.elementEpoch),
        inclinationDeg: value.inclinationDeg,
        categories: value.categories,
      }
    : null;
}
