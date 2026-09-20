import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { SatelliteDataService } from '../core/satellite-data.service';
import { ReticleLocationService } from '../core/reticle-location.service';
import { SatelliteTelemetryService } from '../core/satellite-telemetry.service';
import { SimulationTimeService } from '../core/simulation-time.service';
import { SatellitePropagator } from '../orbital/satellite-propagator';
import { GlobeEngine } from './globe-engine';

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
  private readonly satelliteTelemetry = inject(SatelliteTelemetryService);
  private readonly simulationTime = inject(SimulationTimeService);
  private engine?: GlobeEngine;

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.engine = new GlobeEngine(
        this.canvas.nativeElement,
        () => this.simulationTime.now(),
        this.satelliteLabel.nativeElement,
        this.document.baseURI,
        (coordinates) => {
          this.ngZone.run(() => this.reticleLocation.updateCoordinates(coordinates));
        },
      );
      this.engine.start();
    });

    void this.loadIss();
  }

  ngOnDestroy(): void {
    this.engine?.dispose();
    this.engine = undefined;
  }

  private async loadIss(): Promise<void> {
    this.satelliteTelemetry.setLoading();

    try {
      const omm = await this.satelliteData.loadIss();
      const propagator = new SatellitePropagator(omm);

      this.ngZone.runOutsideAngular(() => {
        this.engine?.setSatellite(propagator, {
          onTelemetry: (telemetry) => {
            this.ngZone.run(() => this.satelliteTelemetry.update(telemetry));
          },
          onError: () => {
            this.ngZone.run(() => this.satelliteTelemetry.setUnavailable());
          },
        });
      });
    } catch (error) {
      console.error('Unable to load ISS orbital elements.', error);
      this.satelliteTelemetry.setUnavailable();
    }
  }
}
