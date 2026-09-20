import { TestBed } from '@angular/core/testing';
import { ObserverLocationService, validateObserverCoordinates } from './observer-location.service';

describe('ObserverLocationService', () => {
  it('starts disabled without requesting or storing a location', () => {
    const service = TestBed.inject(ObserverLocationService);
    expect(service.enabled()).toBe(false);
    expect(service.location()).toBeNull();
    expect(service.status()).toBe('disabled');
  });

  it('accepts a manual observer location without persistence', () => {
    const service = TestBed.inject(ObserverLocationService);
    service.setManualLocation(33.4484, -112.074);
    expect(service.enabled()).toBe(true);
    expect(service.source()).toBe('manual');
    expect(service.location()).toEqual({
      latitudeDeg: 33.4484,
      longitudeDeg: -112.074,
      altitudeKm: 0,
    });
  });

  it('validates latitude and longitude bounds', () => {
    expect(() => validateObserverCoordinates(90.1, 0)).toThrowError(/Latitude/);
    expect(() => validateObserverCoordinates(0, -180.1)).toThrowError(/Longitude/);
    expect(() => validateObserverCoordinates(-90, 180)).not.toThrow();
  });
});
