import { Injectable, signal } from '@angular/core';
import {
  ObserverLocation,
  ObserverLocationSource,
  ObserverSatelliteLook,
  ObserverStatus,
  SatellitePassPrediction,
  SelectedObserverLook,
} from '../models/observer.model';

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 10_000,
};

@Injectable({ providedIn: 'root' })
export class ObserverLocationService {
  private readonly enabledState = signal(false);
  private readonly locationState = signal<ObserverLocation | null>(null);
  private readonly sourceState = signal<ObserverLocationSource | null>(null);
  private readonly statusState = signal<ObserverStatus>('disabled');
  private readonly errorState = signal<string | null>(null);
  private readonly aboveSatellitesState = signal<readonly ObserverSatelliteLook[]>([]);
  private readonly selectedLookState = signal<SelectedObserverLook | null>(null);
  private readonly passPredictionState = signal<SatellitePassPrediction | null>(null);
  private readonly passPendingState = signal(false);
  private readonly aboveOnlyState = signal(false);

  readonly enabled = this.enabledState.asReadonly();
  readonly location = this.locationState.asReadonly();
  readonly source = this.sourceState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly aboveSatellites = this.aboveSatellitesState.asReadonly();
  readonly selectedLook = this.selectedLookState.asReadonly();
  readonly passPrediction = this.passPredictionState.asReadonly();
  readonly passPending = this.passPendingState.asReadonly();
  readonly aboveOnly = this.aboveOnlyState.asReadonly();

  enable(): void {
    this.enabledState.set(true);
    this.statusState.set(this.locationState() ? 'active' : 'ready');
    this.errorState.set(null);
  }

  disable(): void {
    this.enabledState.set(false);
    this.locationState.set(null);
    this.sourceState.set(null);
    this.statusState.set('disabled');
    this.errorState.set(null);
    this.clearCalculatedState();
    this.aboveOnlyState.set(false);
  }

  useBrowserLocation(): void {
    this.enable();
    if (!navigator.geolocation) {
      this.setError('Browser location is not supported. Enter coordinates manually.');
      return;
    }

    this.statusState.set('locating');
    this.errorState.set(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.setLocation(
          {
            latitudeDeg: position.coords.latitude,
            longitudeDeg: position.coords.longitude,
            altitudeKm: (position.coords.altitude ?? 0) / 1_000,
            accuracyMeters: position.coords.accuracy,
          },
          'browser',
        );
      },
      (error) => this.setError(geolocationErrorMessage(error)),
      GEOLOCATION_OPTIONS,
    );
  }

  setManualLocation(latitudeDeg: number, longitudeDeg: number): void {
    validateObserverCoordinates(latitudeDeg, longitudeDeg);
    this.enable();
    this.setLocation({ latitudeDeg, longitudeDeg, altitudeKm: 0 }, 'manual');
  }

  toggleAboveOnly(): void {
    if (this.locationState()) this.aboveOnlyState.update((enabled) => !enabled);
  }

  updateCalculatedState(
    aboveSatellites: readonly ObserverSatelliteLook[],
    selectedLook: SelectedObserverLook | null,
  ): void {
    this.aboveSatellitesState.set(aboveSatellites);
    this.selectedLookState.set(selectedLook);
  }

  setPassPending(): void {
    this.passPendingState.set(true);
    this.passPredictionState.set(null);
  }

  setPassPrediction(prediction: SatellitePassPrediction | null): void {
    this.passPendingState.set(false);
    this.passPredictionState.set(prediction);
  }

  clearCalculatedState(): void {
    this.aboveSatellitesState.set([]);
    this.selectedLookState.set(null);
    this.passPredictionState.set(null);
    this.passPendingState.set(false);
  }

  private setLocation(location: ObserverLocation, source: ObserverLocationSource): void {
    validateObserverCoordinates(location.latitudeDeg, location.longitudeDeg);
    this.locationState.set(location);
    this.sourceState.set(source);
    this.statusState.set('active');
    this.errorState.set(null);
    this.clearCalculatedState();
  }

  private setError(message: string): void {
    this.statusState.set('error');
    this.errorState.set(message);
  }
}

export function validateObserverCoordinates(latitudeDeg: number, longitudeDeg: number): void {
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90) {
    throw new Error('Latitude must be between -90 and +90 degrees.');
  }
  if (!Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
    throw new Error('Longitude must be between -180 and +180 degrees.');
  }
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission was declined. Enter coordinates manually.';
    case error.POSITION_UNAVAILABLE:
      return 'Your location is currently unavailable. Enter coordinates manually.';
    case error.TIMEOUT:
      return 'Location request timed out. Try again or enter coordinates manually.';
    default:
      return 'Unable to determine your location.';
  }
}
