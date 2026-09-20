import { SatelliteRecord, SatelliteTelemetry } from '../models/satellite.model';
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
    stats: { failedCount: number; calculationMs: number },
  ): void;
  onOrbit(index: number, positions: Float32Array): void;
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

  requestOrbit(index: number): void {
    this.post({ type: 'orbit', index, timestampMs: this.timeProvider().getTime() });
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
      { type: 'propagate', timestampMs: this.timeProvider().getTime(), positionsBuffer },
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
        this.callbacks.onFrame(positions, toTelemetry(data.selectedTelemetry), {
          failedCount: data.failedCount,
          calculationMs: data.calculationMs,
        });
        this.positionsBuffer = data.positionsBuffer;
        this.propagationPending = false;
        break;
      }
      case 'orbit':
        this.callbacks.onOrbit(data.index, new Float32Array(data.positionsBuffer));
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
