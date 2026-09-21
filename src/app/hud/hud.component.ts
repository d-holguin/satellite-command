import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ObserverLocationService } from '../core/observer-location.service';
import { ReticleLocationService } from '../core/reticle-location.service';
import { SatelliteStateService } from '../core/satellite-state.service';
import { SimulationTimeService } from '../core/simulation-time.service';
import { ShowcaseService } from '../core/showcase.service';
import {
  SATELLITE_CATEGORIES,
  SatelliteColorMode,
  SatelliteFilter,
  SatelliteRecord,
} from '../models/satellite.model';
import { SIMULATION_SPEEDS, SimulationSpeed } from '../models/simulation.model';
import { calculateOrbitalMetrics } from '../orbital/orbital-context';
import { matchesSatelliteFilter } from '../orbital/satellite-catalog';
import { SkyRadarComponent } from '../observer/sky-radar.component';

@Component({
  selector: 'app-hud',
  standalone: true,
  imports: [DatePipe, SkyRadarComponent],
  templateUrl: './hud.component.html',
  styleUrl: './hud.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HudComponent {
  private readonly simulationTime = inject(SimulationTimeService);
  private readonly satelliteState = inject(SatelliteStateService);
  private readonly reticleLocation = inject(ReticleLocationService);
  private readonly observer = inject(ObserverLocationService);
  private readonly showcase = inject(ShowcaseService);

  protected readonly currentTime = this.simulationTime.currentTime;
  protected readonly simulationMode = this.simulationTime.mode;
  protected readonly simulationSpeed = this.simulationTime.speedMultiplier;
  protected readonly simulationSpeeds = SIMULATION_SPEEDS;
  protected readonly catalog = this.satelliteState.catalog;
  protected readonly catalogStatus = this.satelliteState.status;
  protected readonly trackedCount = this.satelliteState.trackedCount;
  protected readonly displayedCount = computed(() => {
    if (!this.observer.aboveOnly()) return this.satelliteState.displayedCount();
    const satellites = this.satelliteState.catalog()?.satellites ?? [];
    const filter = this.satelliteState.filter();
    return this.observer.aboveSatellites().reduce((count, look) => {
      const satellite = satellites[look.index];
      return count + Number(Boolean(satellite && matchesSatelliteFilter(satellite, filter)));
    }, 0);
  });
  protected readonly activeFilter = this.satelliteState.filter;
  protected readonly selectedSatellite = this.satelliteState.selectedSatellite;
  protected readonly selectedTelemetry = this.satelliteState.selectedTelemetry;
  protected readonly showOrbit = this.satelliteState.showOrbit;
  protected readonly showGroundTrack = this.satelliteState.showGroundTrack;
  protected readonly showVisibilityFootprint = this.satelliteState.showVisibilityFootprint;
  protected readonly follow = this.satelliteState.follow;
  protected readonly colorMode = this.satelliteState.colorMode;
  protected readonly showReferenceOrbits = this.satelliteState.showReferenceOrbits;
  protected readonly searchQuery = this.satelliteState.searchQuery;
  protected readonly searchResults = this.satelliteState.searchResults;
  protected readonly filters: readonly SatelliteFilter[] = ['ALL', ...SATELLITE_CATEGORIES];
  protected readonly reticleCoordinates = this.reticleLocation.coordinates;
  protected readonly reticleAddress = this.reticleLocation.address;
  protected readonly reticleAddressStatus = this.reticleLocation.addressStatus;
  protected readonly googleMapsUrl = this.reticleLocation.googleMapsUrl;
  protected readonly observerEnabled = this.observer.enabled;
  protected readonly observerLocation = this.observer.location;
  protected readonly observerStatus = this.observer.status;
  protected readonly observerError = this.observer.error;
  protected readonly observerAboveCount = computed(() => this.observer.aboveSatellites().length);
  protected readonly aboveOnly = this.observer.aboveOnly;
  protected readonly selectedObserverLook = this.observer.selectedLook;
  protected readonly passPrediction = this.observer.passPrediction;
  protected readonly passPending = this.observer.passPending;
  protected readonly manualLatitude = signal('');
  protected readonly manualLongitude = signal('');
  protected readonly manualError = signal<string | null>(null);
  protected readonly quickViewsExpanded = signal(false);
  protected readonly hoveredSatellite = this.satelliteState.hoveredSatellite;
  protected readonly hoveredRecord = this.satelliteState.hoveredRecord;
  protected readonly visualizationPresets = this.showcase.presets;
  protected readonly activePresetId = this.showcase.activePresetId;
  protected readonly demoActive = this.showcase.demoActive;
  protected readonly demoStage = this.showcase.demoStage;
  protected readonly introVisible = this.showcase.introVisible;

  protected formatLatitude(value: number): string {
    return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? 'N' : 'S'}`;
  }

  protected formatLongitude(value: number): string {
    return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? 'E' : 'W'}`;
  }

  protected formatInteger(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
  }

  protected formatAge(value: string | Date): string {
    const ageMs = Math.max(0, this.currentTime().getTime() - new Date(value).getTime());
    const minutes = Math.floor(ageMs / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  protected orbitalMetrics(satellite: SatelliteRecord) {
    return calculateOrbitalMetrics(satellite);
  }

  protected returnToLive(): void {
    this.registerManualInteraction();
    this.simulationTime.returnToLive();
  }

  protected togglePause(): void {
    this.registerManualInteraction();
    this.simulationTime.togglePause();
  }

  protected setSpeed(speed: SimulationSpeed): void {
    this.registerManualInteraction();
    this.simulationTime.setSpeed(speed);
  }

  protected setFilter(filter: SatelliteFilter): void {
    this.registerManualInteraction();
    this.satelliteState.setFilter(filter);
  }

  protected updateSearch(event: Event): void {
    this.registerManualInteraction();
    this.satelliteState.setSearchQuery((event.target as HTMLInputElement).value);
  }

  protected selectSatellite(index: number): void {
    this.registerManualInteraction();
    this.satelliteState.select(index);
  }

  protected clearSelection(): void {
    this.registerManualInteraction();
    this.satelliteState.select(null);
  }

  protected toggleOrbit(): void {
    this.registerManualInteraction();
    this.satelliteState.toggleOrbit();
  }

  protected toggleGroundTrack(): void {
    this.registerManualInteraction();
    this.satelliteState.toggleGroundTrack();
  }

  protected toggleVisibilityFootprint(): void {
    this.registerManualInteraction();
    this.satelliteState.toggleVisibilityFootprint();
  }

  protected toggleObserverMode(): void {
    this.registerManualInteraction();
    if (this.observer.enabled()) {
      if (this.satelliteState.showVisibilityFootprint()) {
        this.satelliteState.toggleVisibilityFootprint();
      }
      this.observer.disable();
    } else {
      this.observer.enable();
    }
  }

  protected useBrowserLocation(): void {
    this.registerManualInteraction();
    this.observer.useBrowserLocation();
  }

  protected updateManualLatitude(event: Event): void {
    this.registerManualInteraction();
    this.manualLatitude.set((event.target as HTMLInputElement).value);
  }

  protected updateManualLongitude(event: Event): void {
    this.registerManualInteraction();
    this.manualLongitude.set((event.target as HTMLInputElement).value);
  }

  protected applyManualLocation(): void {
    this.registerManualInteraction();
    try {
      if (!this.manualLatitude().trim() || !this.manualLongitude().trim()) {
        throw new Error('Enter both latitude and longitude.');
      }
      this.observer.setManualLocation(
        Number(this.manualLatitude()),
        Number(this.manualLongitude()),
      );
      this.manualError.set(null);
    } catch (error) {
      this.manualError.set(
        error instanceof Error ? error.message : 'Invalid observer coordinates.',
      );
    }
  }

  protected toggleAboveOnly(): void {
    this.registerManualInteraction();
    this.observer.toggleAboveOnly();
  }

  protected toggleFollow(): void {
    this.registerManualInteraction();
    this.satelliteState.toggleFollow();
  }

  protected setColorMode(mode: SatelliteColorMode): void {
    this.registerManualInteraction();
    this.satelliteState.setColorMode(mode);
  }

  protected toggleReferenceOrbits(): void {
    this.registerManualInteraction();
    this.satelliteState.toggleReferenceOrbits();
  }

  protected focusSatellite(): void {
    this.registerManualInteraction();
    this.satelliteState.requestFocus();
  }

  protected applyPreset(id: string): void {
    this.registerManualInteraction();
    this.showcase.applyPreset(id);
  }

  protected startDemo(): void {
    this.quickViewsExpanded.set(true);
    this.showcase.startDemo();
  }

  protected exitDemo(): void {
    this.showcase.exitDemo();
  }

  protected resetView(): void {
    this.showcase.home();
  }

  protected explore(): void {
    this.showcase.dismissIntro();
  }

  protected toggleQuickViews(): void {
    this.quickViewsExpanded.update((expanded) => !expanded);
  }

  @HostListener('document:keydown', ['$event'])
  protected handleKeyboardShortcut(event: KeyboardEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case ' ':
        event.preventDefault();
        this.togglePause();
        break;
      case 'l':
        this.returnToLive();
        break;
      case 'f':
        this.toggleFollow();
        break;
      case 'o':
        this.toggleOrbit();
        break;
      case 'g':
        this.toggleGroundTrack();
        break;
      case 'escape':
        this.registerManualInteraction();
        this.satelliteState.exitCameraMode();
        break;
    }
  }

  private registerManualInteraction(): void {
    this.showcase.registerManualInteraction();
  }
}
