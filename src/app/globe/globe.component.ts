import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  effect,
  inject,
} from '@angular/core';
import { SatelliteDataService } from '../core/satellite-data.service';
import { ReticleLocationService } from '../core/reticle-location.service';
import { ObserverLocationService } from '../core/observer-location.service';
import { SatelliteStateService } from '../core/satellite-state.service';
import { SimulationTimeService } from '../core/simulation-time.service';
import { OrbitWorkerClient } from '../orbital/orbit-worker-client';
import { GlobeEngine } from './globe-engine';

const ANGULAR_TELEMETRY_INTERVAL_MS = 1_000;

@Component({
  selector: 'app-globe',
  standalone: true,
  templateUrl: './globe.component.html',
  styleUrl: './globe.component.scss',
})
export class GlobeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('globeCanvas', { static: true })
  private readonly canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('satelliteLabel', { static: true })
  private readonly satelliteLabel!: ElementRef<HTMLElement>;

  private readonly ngZone = inject(NgZone);
  private readonly document = inject(DOCUMENT);
  private readonly satelliteData = inject(SatelliteDataService);
  private readonly observer = inject(ObserverLocationService);
  private readonly reticleLocation = inject(ReticleLocationService);
  private readonly satelliteState = inject(SatelliteStateService);
  private readonly simulationTime = inject(SimulationTimeService);
  private engine?: GlobeEngine;
  private orbitWorker?: OrbitWorkerClient;
  private lastTelemetryUpdateAtMs = Number.NEGATIVE_INFINITY;
  private lastFailedPropagationCount = 0;
  private lastTrajectoryCenterMs = Number.NEGATIVE_INFINITY;
  private lastTrajectoryRequestAtMs = Number.NEGATIVE_INFINITY;
  private lastPassCenterMs = Number.NEGATIVE_INFINITY;
  private lastPassRequestAtMs = Number.NEGATIVE_INFINITY;

  private readonly filterEffect = effect(() => {
    const filter = this.satelliteState.filter();
    this.engine?.setFilter(filter);
  });

  private readonly selectionEffect = effect(() => {
    const index = this.satelliteState.selectedIndex();
    this.engine?.selectSatellite(index);
    this.orbitWorker?.setSelection(index);
    this.lastTrajectoryCenterMs = Number.NEGATIVE_INFINITY;
    this.lastPassCenterMs = Number.NEGATIVE_INFINITY;
    if (index !== null && this.observer.location()) this.requestPass(index);
    else this.observer.setPassPrediction(null);
  });

  private readonly trajectoryEffect = effect(() => {
    const showOrbit = this.satelliteState.showOrbit();
    const showGroundTrack = this.satelliteState.showGroundTrack();
    const index = this.satelliteState.selectedIndex();
    if (!showOrbit) this.engine?.setOrbitPath(null);
    if (!showGroundTrack) this.engine?.setGroundTrack(null);
    if ((showOrbit || showGroundTrack) && index !== null) this.requestTrajectory(index);
  });

  private readonly focusEffect = effect(() => {
    const request = this.satelliteState.focusRequest();
    const index = this.satelliteState.selectedIndex();
    if (request > 0 && index !== null) this.engine?.focusSatellite(index);
  });

  private readonly followEffect = effect(() => {
    const follow = this.satelliteState.follow();
    this.engine?.setFollowEnabled(follow);
  });

  private readonly colorModeEffect = effect(() => {
    const mode = this.satelliteState.colorMode();
    this.engine?.setColorMode(mode);
  });

  private readonly referenceOrbitEffect = effect(() => {
    const visible = this.satelliteState.showReferenceOrbits();
    this.engine?.setReferenceOrbitsVisible(visible);
  });

  private readonly cameraExitEffect = effect(() => {
    const request = this.satelliteState.exitCameraModeRequest();
    if (request > 0) this.engine?.cancelCameraMotion();
  });

  private readonly simulationTimeEffect = effect(() => {
    const timestamp = this.simulationTime.currentTime();
    this.engine?.setSimulationTime(timestamp);
  });

  private readonly observerEffect = effect(() => {
    const enabled = this.observer.enabled();
    const location = enabled ? this.observer.location() : null;
    this.engine?.setObserverLocation(location);
    this.orbitWorker?.setObserver(location);
    this.engine?.updateAboveHorizonIndices([]);
    this.engine?.setSelectedObserverLook(null);
    this.observer.clearCalculatedState();
    const index = this.satelliteState.selectedIndex();
    if (location && index !== null) this.requestPass(index);
  });

  private readonly aboveOnlyEffect = effect(() => {
    const aboveOnly = this.observer.aboveOnly();
    this.engine?.setObserverAboveOnly(aboveOnly);
  });

  private readonly footprintEffect = effect(() => {
    const visible = this.satelliteState.showVisibilityFootprint();
    const hasObserver = Boolean(this.observer.location());
    this.engine?.setVisibilityFootprintVisible(visible && hasObserver);
  });

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.engine = new GlobeEngine(
        this.canvas.nativeElement,
        this.satelliteLabel.nativeElement,
        this.document.baseURI,
        this.simulationTime.now(),
        (coordinates) => {
          this.ngZone.run(() => this.reticleLocation.updateCoordinates(coordinates));
        },
        (index) => {
          this.ngZone.run(() => this.satelliteState.select(index));
        },
        () => {
          this.ngZone.run(() => this.satelliteState.stopFollow());
        },
      );
      this.engine.start();
    });

    void this.loadCatalog();
  }

  ngOnDestroy(): void {
    this.engine?.dispose();
    this.engine = undefined;
    this.orbitWorker?.dispose();
    this.orbitWorker = undefined;
  }

  private async loadCatalog(): Promise<void> {
    try {
      const catalog = await this.satelliteData.loadCatalog();
      this.ngZone.runOutsideAngular(() => {
        this.engine?.setSatelliteCatalog(catalog.satellites, this.satelliteState.filter());
      });
      this.satelliteState.setCatalog(catalog);

      this.ngZone.runOutsideAngular(() => {
        this.orbitWorker = new OrbitWorkerClient(() => this.simulationTime.now(), {
          onReady: (initializedCount, rejectedCount) => {
            if (rejectedCount > 0) {
              console.warn(`${rejectedCount} catalog objects could not initialize SGP4.`);
            }
            this.ngZone.run(() => this.satelliteState.setTracking(initializedCount));
            const observer = this.observer.location();
            this.orbitWorker?.setObserver(observer);
            const selectedIndex = this.satelliteState.selectedIndex();
            if (observer && selectedIndex !== null) this.requestPass(selectedIndex);
          },
          onFrame: (positions, telemetry, observerSatellites, selectedObserverLook, stats) => {
            this.engine?.updateSatellitePositions(positions);
            this.engine?.updateAboveHorizonIndices(
              observerSatellites.map((satellite) => satellite.index),
            );
            this.engine?.setSelectedObserverLook(selectedObserverLook);
            if (telemetry) this.maybeRefreshTrajectory(telemetry.timestamp.getTime());
            if (telemetry) this.maybeRefreshPass(telemetry.timestamp.getTime());

            if (this.observer.location()) {
              this.ngZone.run(() =>
                this.observer.updateCalculatedState(observerSatellites, selectedObserverLook),
              );
            }

            if (stats.failedCount > 0 && stats.failedCount !== this.lastFailedPropagationCount) {
              console.warn(`${stats.failedCount} catalog objects failed the current propagation.`);
            }
            this.lastFailedPropagationCount = stats.failedCount;

            const nowMs = performance.now();
            if (nowMs - this.lastTelemetryUpdateAtMs >= ANGULAR_TELEMETRY_INTERVAL_MS) {
              this.lastTelemetryUpdateAtMs = nowMs;
              this.ngZone.run(() => this.satelliteState.updateSelectedTelemetry(telemetry));
            }
          },
          onTrajectory: (index, orbitPositions, groundTrackPositions) => {
            if (this.satelliteState.selectedIndex() !== index) return;
            if (this.satelliteState.showOrbit()) this.engine?.setOrbitPath(orbitPositions);
            if (this.satelliteState.showGroundTrack()) {
              this.engine?.setGroundTrack(groundTrackPositions);
            }
          },
          onPass: (prediction) => {
            if (
              !this.observer.location() ||
              this.satelliteState.selectedIndex() !== prediction.index
            ) {
              return;
            }
            this.ngZone.run(() => this.observer.setPassPrediction(prediction));
          },
          onError: (error) => {
            console.error('Orbit worker failed.', error);
            this.ngZone.run(() => this.satelliteState.setUnavailable());
          },
        });
        this.orbitWorker.initialize(catalog.satellites);
      });
    } catch (error) {
      console.error('Unable to load the satellite catalog.', error);
      this.satelliteState.setUnavailable();
    }
  }

  private requestTrajectory(index: number): void {
    const timestampMs = this.orbitWorker?.requestTrajectory(index);
    if (timestampMs === undefined) return;
    this.lastTrajectoryCenterMs = timestampMs;
    this.lastTrajectoryRequestAtMs = performance.now();
  }

  private maybeRefreshTrajectory(timestampMs: number): void {
    const index = this.satelliteState.selectedIndex();
    const satellite = index === null ? null : this.satelliteState.catalog()?.satellites[index];
    if (
      index === null ||
      !satellite ||
      (!this.satelliteState.showOrbit() && !this.satelliteState.showGroundTrack())
    ) {
      return;
    }

    const periodMs = 86_400_000 / satellite.meanMotion;
    const significantChangeMs = Math.min(600_000, Math.max(60_000, periodMs / 60));
    if (
      Math.abs(timestampMs - this.lastTrajectoryCenterMs) >= significantChangeMs &&
      performance.now() - this.lastTrajectoryRequestAtMs >= 1_000
    ) {
      this.requestTrajectory(index);
    }
  }

  private requestPass(index: number): void {
    if (!this.observer.location()) return;
    const timestampMs = this.orbitWorker?.requestPass(index);
    if (timestampMs === undefined) return;
    this.lastPassCenterMs = timestampMs;
    this.lastPassRequestAtMs = performance.now();
    this.ngZone.run(() => this.observer.setPassPending());
  }

  private maybeRefreshPass(timestampMs: number): void {
    const index = this.satelliteState.selectedIndex();
    if (index === null || !this.observer.location()) return;
    if (
      Math.abs(timestampMs - this.lastPassCenterMs) >= 15 * 60_000 &&
      performance.now() - this.lastPassRequestAtMs >= 10_000
    ) {
      this.requestPass(index);
    }
  }
}
