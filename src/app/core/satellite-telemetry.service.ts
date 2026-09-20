import { Injectable, signal } from '@angular/core';
import { SatelliteTelemetry } from '../models/satellite.model';

export type SatelliteTelemetryStatus = 'loading' | 'available' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class SatelliteTelemetryService {
  private readonly telemetryState = signal<SatelliteTelemetry | null>(null);
  private readonly statusState = signal<SatelliteTelemetryStatus>('loading');

  readonly telemetry = this.telemetryState.asReadonly();
  readonly status = this.statusState.asReadonly();

  setLoading(): void {
    this.telemetryState.set(null);
    this.statusState.set('loading');
  }

  update(telemetry: SatelliteTelemetry): void {
    this.telemetryState.set(telemetry);
    this.statusState.set('available');
  }

  setUnavailable(): void {
    this.telemetryState.set(null);
    this.statusState.set('unavailable');
  }
}
