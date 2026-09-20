import { SatelliteRecord } from '../models/satellite.model';
import {
  filterSatelliteIndices,
  parseSatelliteCatalog,
  searchSatellites,
} from './satellite-catalog';

function satellite(
  noradId: number,
  name: string,
  categories: SatelliteRecord['categories'],
): SatelliteRecord {
  return {
    name,
    noradId,
    categories,
    objectId: '2026-001A',
    epoch: '2026-09-19T12:00:00Z',
    meanMotion: 15,
    eccentricity: 0.001,
    inclination: 50,
    raan: 100,
    argPericenter: 20,
    meanAnomaly: 30,
    elementSetNo: 1,
    revAtEpoch: 2,
    bstar: 0,
    meanMotionDot: 0,
    meanMotionDdot: 0,
  };
}

describe('satellite catalog', () => {
  const satellites = [
    satellite(25544, 'ISS (ZARYA)', ['STATIONS']),
    satellite(48274, 'STARLINK-2500', ['STARLINK']),
    satellite(20580, 'HST', ['OTHER']),
  ];

  it('preserves stable indices while filtering', () => {
    expect(filterSatelliteIndices(satellites, 'ALL')).toEqual([0, 1, 2]);
    expect(filterSatelliteIndices(satellites, 'STARLINK')).toEqual([1]);
    expect(filterSatelliteIndices(satellites, 'GEO')).toEqual([]);
  });

  it('searches by partial name and exact NORAD ID', () => {
    expect(searchSatellites(satellites, 'star').map((result) => result.index)).toEqual([1]);
    expect(searchSatellites(satellites, '25544')[0]).toMatchObject({ index: 0 });
    expect(searchSatellites(satellites, 's').map((result) => result.index)).toEqual([1, 2, 0]);
  });

  it('rejects duplicate NORAD IDs in a browser catalog', () => {
    expect(() =>
      parseSatelliteCatalog({
        version: 1,
        generatedAt: '2026-09-19T12:00:00Z',
        source: 'test',
        satellites: [satellites[0], satellites[0]],
      }),
    ).toThrowError('duplicate NORAD ID 25544');
  });
});
