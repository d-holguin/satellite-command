import type { SatelliteOmm } from '../models/satellite.model';
import { vectorMagnitude } from './coordinate-converter';
import { SatellitePropagator } from './satellite-propagator';

const ISS_OMM: SatelliteOmm = {
  OBJECT_NAME: 'ISS (ZARYA)',
  OBJECT_ID: '1998-067A',
  EPOCH: '2026-09-19T19:40:49.539648',
  MEAN_MOTION: 15.49182662,
  ECCENTRICITY: 0.00048047,
  INCLINATION: 51.6308,
  RA_OF_ASC_NODE: 191.7362,
  ARG_OF_PERICENTER: 159.3703,
  MEAN_ANOMALY: 200.748,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 58642,
  BSTAR: 0.00012770874,
  MEAN_MOTION_DOT: 0.00006637,
  MEAN_MOTION_DDOT: 0,
};

describe('SatellitePropagator', () => {
  it('returns physically plausible ISS state at the element epoch', () => {
    const epoch = new Date(`${ISS_OMM.EPOCH}Z`);
    const state = new SatellitePropagator(ISS_OMM).propagate(epoch);
    const normalizedRadius = vectorMagnitude(state.worldPosition);

    expect(state.telemetry.noradId).toBe(25544);
    expect(state.telemetry.altitudeKm).toBeGreaterThan(300);
    expect(state.telemetry.altitudeKm).toBeLessThan(500);
    expect(state.telemetry.velocityKmS).toBeGreaterThan(7);
    expect(state.telemetry.velocityKmS).toBeLessThan(8);
    expect(Math.abs(state.telemetry.latitudeDeg)).toBeLessThanOrEqual(51.7);
    expect(normalizedRadius).toBeGreaterThan(1.05);
    expect(normalizedRadius).toBeLessThan(1.09);
    expect(state.telemetry.timestamp).toEqual(epoch);
  });

  it('advances the predicted position without changing the element set', () => {
    const propagator = new SatellitePropagator(ISS_OMM);
    const epochMs = Date.parse(`${ISS_OMM.EPOCH}Z`);
    const first = propagator.propagate(new Date(epochMs));
    const later = propagator.propagate(new Date(epochMs + 60_000));

    expect(later.telemetry.latitudeDeg).not.toBeCloseTo(first.telemetry.latitudeDeg, 3);
    expect(later.telemetry.longitudeDeg).not.toBeCloseTo(first.telemetry.longitudeDeg, 3);
    expect(later.telemetry.timestamp.getTime()).toBe(epochMs + 60_000);
  });
});
