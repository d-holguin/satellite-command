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
  private readonly reticleLocation = inject(ReticleLocationService);
  private readonly satelliteState = inject(SatelliteStateService);
  private readonly simulationTime = inject(SimulationTimeService);
  private engine?: GlobeEngine;
  private orbitWorker?: OrbitWorkerClient;
  private lastTelemetryUpdateAtMs = Number.NEGATIVE_INFINITY;
  private lastFailedPropagationCount = 0;

  private readonly filterEffect = effect(() => {
    const filter = this.satelliteState.filter();
    this.engine?.setFilter(filter);
  });

  private readonly selectionEffect = effect(() => {
    const index = this.satelliteState.selectedIndex();
    this.engine?.selectSatellite(index);
    this.orbitWorker?.setSelection(index);
  });

  private readonly orbitEffect = effect(() => {
    const showOrbit = this.satelliteState.showOrbit();
    const index = this.satelliteState.selectedIndex();
    this.engine?.setOrbitPath(null);
    if (showOrbit && index !== null) this.orbitWorker?.requestOrbit(index);
  });

  private readonly focusEffect = effect(() => {
    const request = this.satelliteState.focusRequest();
    const index = this.satelliteState.selectedIndex();
    if (request > 0 && index !== null) this.engine?.focusSatellite(index);
  });

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.engine = new GlobeEngine(
        this.canvas.nativeElement,
        this.satelliteLabel.nativeElement,
        this.document.baseURI,
        (coordinates) => {
          this.ngZone.run(() => this.reticleLocation.updateCoordinates(coordinates));
        },
        (index) => {
          this.ngZone.run(() => this.satelliteState.select(index));
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
          },
          onFrame: (positions, telemetry, stats) => {
            this.engine?.updateSatellitePositions(positions);

            if (
              stats.failedCount > 0 &&
              stats.failedCount !== this.lastFailedPropagationCount
            ) {
              console.warn(`${stats.failedCount} catalog objects failed the current propagation.`);
            }
            this.lastFailedPropagationCount = stats.failedCount;

            const nowMs = performance.now();
            if (nowMs - this.lastTelemetryUpdateAtMs >= ANGULAR_TELEMETRY_INTERVAL_MS) {
              this.lastTelemetryUpdateAtMs = nowMs;
              this.ngZone.run(() => this.satelliteState.updateSelectedTelemetry(telemetry));
            }
          },
          onOrbit: (index, positions) => {
            if (this.satelliteState.showOrbit() && this.satelliteState.selectedIndex() === index) {
              this.engine?.setOrbitPath(positions);
            }
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
}
