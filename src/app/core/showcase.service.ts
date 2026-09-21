import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ObserverLocationService } from './observer-location.service';
import { SatelliteStateService } from './satellite-state.service';
import { SimulationTimeService } from './simulation-time.service';
import { SatelliteColorMode, SatelliteFilter } from '../models/satellite.model';
import { SimulationClockState } from '../models/simulation.model';
import {
  CameraPresetId,
  CameraPresetRequest,
  VisualizationPreset,
} from '../models/visualization.model';

export const VISUALIZATION_PRESETS: readonly VisualizationPreset[] = [
  {
    id: 'ORBITAL_OVERVIEW',
    label: 'Orbital Overview',
    description: 'All active objects · full orbital scale',
    filter: 'ALL',
    colorMode: 'CATEGORY',
    orbitalBands: true,
    cameraPreset: 'OVERVIEW',
  },
  {
    id: 'STARLINK_SWARM',
    label: 'Starlink Swarm',
    description: 'Low-Earth Starlink shell',
    filter: 'STARLINK',
    colorMode: 'CATEGORY',
    orbitalBands: false,
    cameraPreset: 'LEO',
  },
  {
    id: 'GPS_CONSTELLATION',
    label: 'GPS Constellation',
    description: 'GPS navigation satellites · MEO',
    filter: 'GPS',
    colorMode: 'CATEGORY',
    orbitalBands: true,
    cameraPreset: 'MEO',
  },
  {
    id: 'GEO_BELT',
    label: 'GEO Belt',
    description: 'Geostationary ring · GEO',
    filter: 'GEO',
    colorMode: 'CATEGORY',
    orbitalBands: true,
    cameraPreset: 'GEO',
  },
  {
    id: 'ISS_TRACK',
    label: 'ISS Track',
    description: 'ISS orbit + surface track',
    filter: 'STATIONS',
    colorMode: 'CATEGORY',
    simulationSpeed: 1,
    orbitalBands: false,
    groundTrack: true,
    showOrbit: true,
    targetNoradId: 25544,
    cameraPreset: 'LEO',
  },
  {
    id: 'TIME_WARP',
    label: 'Time Warp',
    description: '1000× orbital motion',
    filter: 'ALL',
    colorMode: 'ALTITUDE',
    simulationSpeed: 1_000,
    orbitalBands: true,
    cameraPreset: 'OVERVIEW',
  },
] as const;

interface ShowcaseSnapshot {
  filter: SatelliteFilter;
  colorMode: SatelliteColorMode;
  selectedIndex: number | null;
  showOrbit: boolean;
  showGroundTrack: boolean;
  showReferenceOrbits: boolean;
  follow: boolean;
  aboveOnly: boolean;
  clock: SimulationClockState;
}

interface DemoStage {
  atMs: number;
  label: string;
  run: () => void;
}

@Injectable({ providedIn: 'root' })
export class ShowcaseService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly satelliteState = inject(SatelliteStateService);
  private readonly simulationTime = inject(SimulationTimeService);
  private readonly observer = inject(ObserverLocationService);
  private readonly cameraRequestState = signal<CameraPresetRequest>({
    preset: 'EARTH',
    sequence: 0,
  });
  private readonly activePresetState = signal<string | null>(null);
  private readonly demoActiveState = signal(false);
  private readonly demoStageState = signal<string | null>(null);
  private readonly introDismissedState = signal(false);
  private demoTimers: number[] = [];
  private snapshot: ShowcaseSnapshot | null = null;

  readonly presets = VISUALIZATION_PRESETS;
  readonly cameraRequest = this.cameraRequestState.asReadonly();
  readonly activePresetId = this.activePresetState.asReadonly();
  readonly demoActive = this.demoActiveState.asReadonly();
  readonly demoStage = this.demoStageState.asReadonly();
  readonly introVisible = computed(
    () =>
      !this.introDismissedState() &&
      !this.demoActiveState() &&
      this.satelliteState.status() === 'tracking',
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.clearDemoTimers());
  }

  applyPreset(id: string): void {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    this.applyPresetState(preset);
  }

  requestCamera(preset: CameraPresetId): void {
    this.cameraRequestState.update((request) => ({
      preset,
      sequence: request.sequence + 1,
    }));
  }

  home(): void {
    this.exitDemo(false);
    this.introDismissedState.set(true);
    this.activePresetState.set(null);
    this.observer.setAboveOnly(false);
    this.satelliteState.resetVisualization();
    this.simulationTime.returnToLive();
    this.requestCamera('EARTH');
  }

  dismissIntro(): void {
    this.introDismissedState.set(true);
  }

  startDemo(): void {
    if (this.demoActiveState()) return;
    this.snapshot = this.captureSnapshot();
    this.clearDemoTimers();
    this.introDismissedState.set(true);
    this.demoActiveState.set(true);

    const stages: DemoStage[] = [
      { atMs: 0, label: 'Earth Overview', run: () => this.prepareDemoOpening() },
      {
        atMs: 5_000,
        label: 'All Active Satellites',
        run: () => this.applyPresetState(this.requirePreset('ORBITAL_OVERVIEW')),
      },
      {
        atMs: 11_000,
        label: 'Starlink Swarm',
        run: () => this.applyPresetState(this.requirePreset('STARLINK_SWARM')),
      },
      {
        atMs: 17_000,
        label: 'Time Acceleration',
        run: () => this.applyPresetState(this.requirePreset('TIME_WARP')),
      },
      {
        atMs: 23_000,
        label: 'GPS Constellation',
        run: () => this.applyPresetState(this.requirePreset('GPS_CONSTELLATION')),
      },
      {
        atMs: 29_000,
        label: 'Geostationary Belt',
        run: () => this.applyPresetState(this.requirePreset('GEO_BELT')),
      },
      {
        atMs: 35_000,
        label: 'ISS Orbit + Ground Track',
        run: () => this.applyPresetState(this.requirePreset('ISS_TRACK')),
      },
    ];

    for (const stage of stages) {
      this.demoTimers.push(
        window.setTimeout(() => {
          if (!this.demoActiveState()) return;
          this.demoStageState.set(stage.label);
          stage.run();
        }, stage.atMs),
      );
    }
    this.demoTimers.push(window.setTimeout(() => this.exitDemo(), 43_000));
  }

  exitDemo(restore = true): void {
    if (!this.demoActiveState() && !this.snapshot) return;
    this.clearDemoTimers();
    this.demoActiveState.set(false);
    this.demoStageState.set(null);
    if (restore && this.snapshot) this.restoreSnapshot(this.snapshot);
    this.snapshot = null;
  }

  registerManualInteraction(): void {
    this.introDismissedState.set(true);
    if (this.demoActiveState()) this.exitDemo(false);
    this.activePresetState.set(null);
    this.satelliteState.exitCameraMode();
  }

  private applyPresetState(preset: VisualizationPreset): void {
    this.activePresetState.set(preset.id);
    this.observer.setAboveOnly(false);
    if (preset.filter) this.satelliteState.setFilter(preset.filter);
    if (preset.colorMode) this.satelliteState.setColorMode(preset.colorMode);
    this.satelliteState.setReferenceOrbitsVisible(Boolean(preset.orbitalBands));

    const targetIndex =
      preset.targetNoradId === undefined
        ? null
        : (this.satelliteState
            .catalog()
            ?.satellites.findIndex((satellite) => satellite.noradId === preset.targetNoradId) ??
          -1);
    this.satelliteState.select(targetIndex !== null && targetIndex >= 0 ? targetIndex : null);
    this.satelliteState.setOrbitVisible(Boolean(preset.showOrbit));
    this.satelliteState.setGroundTrackVisible(Boolean(preset.groundTrack));
    if (preset.simulationSpeed !== undefined) this.simulationTime.setSpeed(preset.simulationSpeed);

    if (preset.targetNoradId && targetIndex !== null && targetIndex >= 0) {
      this.satelliteState.requestFocus();
    } else {
      this.requestCamera(preset.cameraPreset);
    }
  }

  private prepareDemoOpening(): void {
    this.observer.setAboveOnly(false);
    this.satelliteState.resetVisualization();
    this.simulationTime.returnToLive();
    this.requestCamera('EARTH');
  }

  private captureSnapshot(): ShowcaseSnapshot {
    return {
      filter: this.satelliteState.filter(),
      colorMode: this.satelliteState.colorMode(),
      selectedIndex: this.satelliteState.selectedIndex(),
      showOrbit: this.satelliteState.showOrbit(),
      showGroundTrack: this.satelliteState.showGroundTrack(),
      showReferenceOrbits: this.satelliteState.showReferenceOrbits(),
      follow: this.satelliteState.follow(),
      aboveOnly: this.observer.aboveOnly(),
      clock: this.simulationTime.state(),
    };
  }

  private restoreSnapshot(snapshot: ShowcaseSnapshot): void {
    this.satelliteState.setFilter(snapshot.filter);
    this.satelliteState.setColorMode(snapshot.colorMode);
    this.satelliteState.select(snapshot.selectedIndex);
    this.satelliteState.setOrbitVisible(snapshot.showOrbit);
    this.satelliteState.setGroundTrackVisible(snapshot.showGroundTrack);
    this.satelliteState.setReferenceOrbitsVisible(snapshot.showReferenceOrbits);
    this.satelliteState.setFollow(snapshot.follow);
    this.observer.setAboveOnly(snapshot.aboveOnly);
    this.simulationTime.restore(snapshot.clock);
    this.activePresetState.set(null);
    this.requestCamera('EARTH');
  }

  private requirePreset(id: string): VisualizationPreset {
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (!preset) throw new Error(`Unknown visualization preset: ${id}`);
    return preset;
  }

  private clearDemoTimers(): void {
    for (const timer of this.demoTimers) window.clearTimeout(timer);
    this.demoTimers = [];
  }
}
