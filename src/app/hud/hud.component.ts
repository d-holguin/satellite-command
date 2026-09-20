import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReticleLocationService } from '../core/reticle-location.service';
import { SatelliteTelemetryService } from '../core/satellite-telemetry.service';
import { SimulationTimeService } from '../core/simulation-time.service';

@Component({
  selector: 'app-hud',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './hud.component.html',
  styleUrl: './hud.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HudComponent {
  private readonly simulationTime = inject(SimulationTimeService);
  private readonly satelliteTelemetry = inject(SatelliteTelemetryService);
  private readonly reticleLocation = inject(ReticleLocationService);

  protected readonly currentTime = this.simulationTime.currentTime;
  protected readonly issTelemetry = this.satelliteTelemetry.telemetry;
  protected readonly issStatus = this.satelliteTelemetry.status;
  protected readonly reticleCoordinates = this.reticleLocation.coordinates;
  protected readonly reticleAddress = this.reticleLocation.address;
  protected readonly reticleAddressStatus = this.reticleLocation.addressStatus;
  protected readonly googleMapsUrl = this.reticleLocation.googleMapsUrl;

  protected formatLatitude(value: number): string {
    return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? 'N' : 'S'}`;
  }

  protected formatLongitude(value: number): string {
    return `${Math.abs(value).toFixed(3)}° ${value >= 0 ? 'E' : 'W'}`;
  }
}
