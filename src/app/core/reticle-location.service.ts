import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { GeographicCoordinates } from '../models/geography.model';

const LOOKUP_DEBOUNCE_MS = 900;
const MIN_LOOKUP_INTERVAL_MS = 1_100;

export type ReticleAddressStatus = 'waiting' | 'loading' | 'available' | 'unavailable';

export interface ReticleAddress {
  primaryLine: string;
  secondaryLine: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReticleLocationService {
  private readonly coordinatesState = signal<GeographicCoordinates | null>(null);
  private readonly addressState = signal<ReticleAddress | null>(null);
  private readonly addressStatusState = signal<ReticleAddressStatus>('waiting');
  private readonly cache = new Map<string, ReticleAddress | null>();

  private lookupTimer: number | undefined;
  private currentLookupKey: string | null = null;
  private lastLookupStartedAt = Number.NEGATIVE_INFINITY;
  private destroyed = false;

  readonly coordinates = this.coordinatesState.asReadonly();
  readonly address = this.addressState.asReadonly();
  readonly addressStatus = this.addressStatusState.asReadonly();
  readonly googleMapsUrl = computed(() => {
    const coordinates = this.coordinatesState();
    if (!coordinates) {
      return null;
    }

    const query = `${coordinates.latitudeDeg.toFixed(6)},${coordinates.longitudeDeg.toFixed(6)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.clearLookupTimer();
    });
  }

  updateCoordinates(coordinates: GeographicCoordinates): void {
    this.coordinatesState.set(coordinates);

    // About 100 m at the equator: precise enough for the readout while avoiding
    // a new network lookup for every tiny movement caused by control damping.
    const lookupKey = `${coordinates.latitudeDeg.toFixed(3)},${coordinates.longitudeDeg.toFixed(3)}`;
    if (lookupKey === this.currentLookupKey) {
      return;
    }

    this.currentLookupKey = lookupKey;
    this.clearLookupTimer();

    if (this.cache.has(lookupKey)) {
      this.applyAddress(lookupKey, this.cache.get(lookupKey) ?? null);
      return;
    }

    this.addressState.set(null);
    this.addressStatusState.set('waiting');

    const rateLimitDelay = Math.max(
      0,
      MIN_LOOKUP_INTERVAL_MS - (Date.now() - this.lastLookupStartedAt),
    );
    this.lookupTimer = window.setTimeout(
      () => void this.reverseGeocode(coordinates, lookupKey),
      Math.max(LOOKUP_DEBOUNCE_MS, rateLimitDelay),
    );
  }

  private async reverseGeocode(
    coordinates: GeographicCoordinates,
    lookupKey: string,
  ): Promise<void> {
    this.lookupTimer = undefined;
    this.lastLookupStartedAt = Date.now();

    if (this.currentLookupKey === lookupKey) {
      this.addressStatusState.set('loading');
    }

    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', coordinates.latitudeDeg.toFixed(6));
    url.searchParams.set('lon', coordinates.longitudeDeg.toFixed(6));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'en');

    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });

      if (response.status === 404) {
        this.cache.set(lookupKey, null);
        this.applyAddress(lookupKey, null);
        return;
      }

      if (!response.ok) {
        throw new Error(`Reverse geocoding failed with HTTP ${response.status}.`);
      }

      const address = parseNominatimAddress(await response.json());
      this.cache.set(lookupKey, address);
      this.applyAddress(lookupKey, address);
    } catch (error) {
      if (this.currentLookupKey === lookupKey && !this.destroyed) {
        this.addressState.set(null);
        this.addressStatusState.set('unavailable');
      }
      console.warn('Unable to resolve the reticle address.', error);
    }
  }

  private applyAddress(lookupKey: string, address: ReticleAddress | null): void {
    if (this.currentLookupKey !== lookupKey || this.destroyed) {
      return;
    }

    this.addressState.set(address);
    this.addressStatusState.set(address ? 'available' : 'unavailable');
  }

  private clearLookupTimer(): void {
    if (this.lookupTimer === undefined) {
      return;
    }

    window.clearTimeout(this.lookupTimer);
    this.lookupTimer = undefined;
  }
}

function parseNominatimAddress(value: unknown): ReticleAddress | null {
  if (!isRecord(value)) {
    return null;
  }

  const displayName = readString(value, 'display_name');
  const components = isRecord(value['address']) ? value['address'] : {};
  const road = firstString(components, ['road', 'pedestrian', 'footway', 'path']);
  const houseNumber = readString(components, 'house_number');
  const locality = firstString(components, [
    'city',
    'town',
    'village',
    'municipality',
    'hamlet',
    'suburb',
    'neighbourhood',
    'county',
  ]);
  const region = firstString(components, ['state', 'province', 'region']);
  const country = readString(components, 'country');
  const street = [houseNumber, road].filter((part): part is string => Boolean(part)).join(' ');
  const primaryLine = street || locality || displayName;

  if (!primaryLine) {
    return null;
  }

  const secondaryParts = [locality, region, country].filter(
    (part, index, parts): part is string =>
      Boolean(part) && part !== primaryLine && parts.indexOf(part) === index,
  );

  return {
    primaryLine,
    secondaryLine: secondaryParts.length > 0 ? secondaryParts.join(', ') : null,
  };
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) {
      return value;
    }
  }

  return null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
