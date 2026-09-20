import { computed, Injectable, signal } from '@angular/core';
import { SatelliteCatalog, SatelliteFilter, SatelliteTelemetry } from '../models/satellite.model';
import { matchesSatelliteFilter, searchSatellites } from '../orbital/satellite-catalog';

export type CatalogStatus = 'loading' | 'initializing' | 'tracking' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class SatelliteStateService {
  private readonly catalogState = signal<SatelliteCatalog | null>(null);
  private readonly statusState = signal<CatalogStatus>('loading');
  private readonly filterState = signal<SatelliteFilter>('ALL');
  private readonly selectedIndexState = signal<number | null>(null);
  private readonly selectedTelemetryState = signal<SatelliteTelemetry | null>(null);
  private readonly searchQueryState = signal('');
  private readonly showOrbitState = signal(false);
  private readonly focusRequestState = signal(0);
  private readonly initializedCountState = signal(0);

  readonly catalog = this.catalogState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly filter = this.filterState.asReadonly();
  readonly selectedIndex = this.selectedIndexState.asReadonly();
  readonly selectedTelemetry = this.selectedTelemetryState.asReadonly();
  readonly searchQuery = this.searchQueryState.asReadonly();
  readonly showOrbit = this.showOrbitState.asReadonly();
  readonly focusRequest = this.focusRequestState.asReadonly();
  readonly trackedCount = this.initializedCountState.asReadonly();
  readonly selectedSatellite = computed(() => {
    const index = this.selectedIndexState();
    return index === null ? null : (this.catalogState()?.satellites[index] ?? null);
  });
  readonly displayedCount = computed(() => {
    const catalog = this.catalogState();
    const filter = this.filterState();
    return catalog
      ? catalog.satellites.reduce(
          (count, satellite) => count + Number(matchesSatelliteFilter(satellite, filter)),
          0,
        )
      : 0;
  });
  readonly searchResults = computed(() =>
    searchSatellites(this.catalogState()?.satellites ?? [], this.searchQueryState()),
  );

  setCatalog(catalog: SatelliteCatalog): void {
    this.catalogState.set(catalog);
    this.statusState.set('initializing');
  }

  setTracking(initializedCount: number): void {
    this.initializedCountState.set(initializedCount);
    this.statusState.set('tracking');
  }

  setUnavailable(): void {
    this.statusState.set('unavailable');
    this.initializedCountState.set(0);
  }

  setFilter(filter: SatelliteFilter): void {
    this.filterState.set(filter);
  }

  setSearchQuery(query: string): void {
    this.searchQueryState.set(query);
  }

  select(index: number | null): void {
    const satelliteCount = this.catalogState()?.satellites.length ?? 0;
    if (index !== null && (index < 0 || index >= satelliteCount)) {
      return;
    }

    this.selectedIndexState.set(index);
    this.selectedTelemetryState.set(null);
    this.showOrbitState.set(false);
    this.searchQueryState.set('');
  }

  updateSelectedTelemetry(telemetry: SatelliteTelemetry | null): void {
    this.selectedTelemetryState.set(telemetry);
  }

  toggleOrbit(): void {
    if (this.selectedIndexState() !== null) {
      this.showOrbitState.update((visible) => !visible);
    }
  }

  requestFocus(): void {
    if (this.selectedIndexState() !== null) {
      this.focusRequestState.update((request) => request + 1);
    }
  }
}
