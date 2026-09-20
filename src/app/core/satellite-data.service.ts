import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { SatelliteCatalog } from '../models/satellite.model';
import { parseSatelliteCatalog } from '../orbital/satellite-catalog';

@Injectable({ providedIn: 'root' })
export class SatelliteDataService {
  private readonly document = inject(DOCUMENT);
  private catalogRequest?: Promise<SatelliteCatalog>;

  loadCatalog(): Promise<SatelliteCatalog> {
    this.catalogRequest ??= this.fetchCatalog();
    return this.catalogRequest;
  }

  private async fetchCatalog(): Promise<SatelliteCatalog> {
    const assetUrl = new URL('data/satellites.json', this.document.baseURI);
    const response = await fetch(assetUrl);

    if (!response.ok) {
      throw new Error(`Satellite catalog request failed with HTTP ${response.status}.`);
    }

    return parseSatelliteCatalog(await response.json());
  }
}
