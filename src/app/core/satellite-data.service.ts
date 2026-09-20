import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { SatelliteOmm } from '../models/satellite.model';

const ISS_NORAD_ID = 25_544;
const REQUIRED_NUMERIC_FIELDS = [
  'NORAD_CAT_ID',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'ELEMENT_SET_NO',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

@Injectable({ providedIn: 'root' })
export class SatelliteDataService {
  private readonly document = inject(DOCUMENT);
  private issRequest?: Promise<SatelliteOmm>;

  loadIss(): Promise<SatelliteOmm> {
    this.issRequest ??= this.fetchIss();
    return this.issRequest;
  }

  private async fetchIss(): Promise<SatelliteOmm> {
    const assetUrl = new URL('data/iss-omm.json', this.document.baseURI);
    const response = await fetch(assetUrl);

    if (!response.ok) {
      throw new Error(`ISS data request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (!isSatelliteOmm(payload) || Number(payload.NORAD_CAT_ID) !== ISS_NORAD_ID) {
      throw new Error('The ISS OMM asset is missing or invalid.');
    }

    return payload;
  }
}

function isSatelliteOmm(value: unknown): value is SatelliteOmm {
  if (!isRecord(value)) {
    return false;
  }

  const hasStrings =
    isNonEmptyString(value['OBJECT_NAME']) &&
    isNonEmptyString(value['OBJECT_ID']) &&
    isNonEmptyString(value['EPOCH']) &&
    Number.isFinite(Date.parse(ensureUtc(value['EPOCH'])));

  return hasStrings && REQUIRED_NUMERIC_FIELDS.every((field) => isNumberLike(value[field]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumberLike(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  );
}

function ensureUtc(epoch: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(epoch) ? epoch : `${epoch}Z`;
}
