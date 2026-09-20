import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReticleLocationService } from '../core/reticle-location.service';
import { SatelliteStateService } from '../core/satellite-state.service';
import { SimulationTimeService } from '../core/simulation-time.service';
import { SATELLITE_CATEGORIES, SatelliteFilter } from '../models/satellite.model';

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
  private readonly satelliteState = inject(SatelliteStateService);
  private readonly reticleLocation = inject(ReticleLocationService);

  protected readonly currentTime = this.simulationTime.currentTime;
  protected readonly catalog = this.satelliteState.catalog;
  protected readonly catalogStatus = this.satelliteState.status;
  protected readonly trackedCount = this.satelliteState.trackedCount;
  protected readonly displayedCount = this.satelliteState.displayedCount;
  protected readonly activeFilter = this.satelliteState.filter;
  protected readonly selectedSatellite = this.satelliteState.selectedSatellite;
  protected readonly selectedTelemetry = this.satelliteState.selectedTelemetry;
  protected readonly showOrbit = this.satelliteState.showOrbit;
  protected readonly searchQuery = this.satelliteState.searchQuery;
  protected readonly searchResults = this.satelliteState.searchResults;
  protected readonly filters: readonly SatelliteFilter[] = ['ALL', ...SATELLITE_CATEGORIES];
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

  protected setFilter(filter: SatelliteFilter): void {
    this.satelliteState.setFilter(filter);
  }

  protected updateSearch(event: Event): void {
    this.satelliteState.setSearchQuery((event.target as HTMLInputElement).value);
  }

  protected selectSatellite(index: number): void {
    this.satelliteState.select(index);
  }

  protected clearSelection(): void {
    this.satelliteState.select(null);
  }

  protected toggleOrbit(): void {
    this.satelliteState.toggleOrbit();
  }

  protected focusSatellite(): void {
    this.satelliteState.requestFocus();
  }
}
