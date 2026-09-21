import { computed, Injectable, signal } from '@angular/core';
import {
  SatelliteCatalog,
  SatelliteColorMode,
  SatelliteFilter,
  SatelliteTelemetry,
} from '../models/satellite.model';
import { HoveredSatellite } from '../models/visualization.model';
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
  private readonly showGroundTrackState = signal(false);
  private readonly showVisibilityFootprintState = signal(false);
  private readonly followState = signal(false);
  private readonly colorModeState = signal<SatelliteColorMode>('CATEGORY');
  private readonly showReferenceOrbitsState = signal(false);
  private readonly focusRequestState = signal(0);
  private readonly exitCameraModeRequestState = signal(0);
  private readonly initializedCountState = signal(0);
  private readonly hoveredSatelliteState = signal<HoveredSatellite | null>(null);

  readonly catalog = this.catalogState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly filter = this.filterState.asReadonly();
  readonly selectedIndex = this.selectedIndexState.asReadonly();
  readonly selectedTelemetry = this.selectedTelemetryState.asReadonly();
  readonly searchQuery = this.searchQueryState.asReadonly();
  readonly showOrbit = this.showOrbitState.asReadonly();
  readonly showGroundTrack = this.showGroundTrackState.asReadonly();
  readonly showVisibilityFootprint = this.showVisibilityFootprintState.asReadonly();
  readonly follow = this.followState.asReadonly();
  readonly colorMode = this.colorModeState.asReadonly();
  readonly showReferenceOrbits = this.showReferenceOrbitsState.asReadonly();
  readonly focusRequest = this.focusRequestState.asReadonly();
  readonly exitCameraModeRequest = this.exitCameraModeRequestState.asReadonly();
  readonly trackedCount = this.initializedCountState.asReadonly();
  readonly hoveredSatellite = this.hoveredSatelliteState.asReadonly();
  readonly hoveredRecord = computed(() => {
    const hovered = this.hoveredSatelliteState();
    return hovered === null ? null : (this.catalogState()?.satellites[hovered.index] ?? null);
  });
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
    const hovered = this.hoveredSatelliteState();
    const hoveredRecord = hovered ? this.catalogState()?.satellites[hovered.index] : null;
    if (hovered && (!hoveredRecord || !matchesSatelliteFilter(hoveredRecord, filter))) {
      this.hoveredSatelliteState.set(null);
    }
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
    this.showGroundTrackState.set(false);
    this.showVisibilityFootprintState.set(false);
    this.followState.set(false);
    this.searchQueryState.set('');
    this.hoveredSatelliteState.set(null);
  }

  setHoveredSatellite(hovered: HoveredSatellite | null): void {
    if (hovered?.index === this.selectedIndexState()) hovered = null;
    const current = this.hoveredSatelliteState();
    if (
      current?.index === hovered?.index &&
      (current === null ||
        hovered === null ||
        Math.abs(current.altitudeKm - hovered.altitudeKm) < 1)
    ) {
      return;
    }
    this.hoveredSatelliteState.set(hovered);
  }

  updateSelectedTelemetry(telemetry: SatelliteTelemetry | null): void {
    this.selectedTelemetryState.set(telemetry);
  }

  toggleOrbit(): void {
    if (this.selectedIndexState() !== null) {
      this.showOrbitState.update((visible) => !visible);
    }
  }

  setOrbitVisible(visible: boolean): void {
    this.showOrbitState.set(visible && this.selectedIndexState() !== null);
  }

  toggleGroundTrack(): void {
    if (this.selectedIndexState() !== null) {
      this.showGroundTrackState.update((visible) => !visible);
    }
  }

  setGroundTrackVisible(visible: boolean): void {
    this.showGroundTrackState.set(visible && this.selectedIndexState() !== null);
  }

  toggleVisibilityFootprint(): void {
    if (this.selectedIndexState() !== null) {
      this.showVisibilityFootprintState.update((visible) => !visible);
    }
  }

  toggleFollow(): void {
    if (this.selectedIndexState() !== null) {
      this.followState.update((enabled) => !enabled);
    }
  }

  stopFollow(): void {
    this.followState.set(false);
  }

  setFollow(enabled: boolean): void {
    this.followState.set(enabled && this.selectedIndexState() !== null);
  }

  setColorMode(mode: SatelliteColorMode): void {
    this.colorModeState.set(mode);
  }

  toggleReferenceOrbits(): void {
    this.showReferenceOrbitsState.update((visible) => !visible);
  }

  setReferenceOrbitsVisible(visible: boolean): void {
    this.showReferenceOrbitsState.set(visible);
  }

  requestFocus(): void {
    if (this.selectedIndexState() !== null) {
      this.focusRequestState.update((request) => request + 1);
    }
  }

  exitCameraMode(): void {
    this.followState.set(false);
    this.exitCameraModeRequestState.update((request) => request + 1);
  }

  resetVisualization(): void {
    this.filterState.set('ALL');
    this.colorModeState.set('CATEGORY');
    this.select(null);
    this.showReferenceOrbitsState.set(false);
    this.showVisibilityFootprintState.set(false);
    this.followState.set(false);
    this.exitCameraModeRequestState.update((request) => request + 1);
  }
}
