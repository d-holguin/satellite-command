import assert from 'node:assert/strict';
import test from 'node:test';
import { collectNoradIds, normalizeCatalog } from './satellite-data-utils.mjs';

function omm(noradId, name, epoch = '2026-09-19T12:00:00Z') {
  return {
    OBJECT_NAME: name,
    OBJECT_ID: `2026-${noradId}A`,
    EPOCH: epoch,
    MEAN_MOTION: 15,
    ECCENTRICITY: 0.001,
    INCLINATION: 51.6,
    RA_OF_ASC_NODE: 100,
    ARG_OF_PERICENTER: 20,
    MEAN_ANOMALY: 30,
    NORAD_CAT_ID: noradId,
    ELEMENT_SET_NO: 1,
    REV_AT_EPOCH: 2,
    BSTAR: 0.0001,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  };
}

test('normalizes fields, assigns official memberships, and adds OTHER', () => {
  const catalog = normalizeCatalog(
    [omm(20, 'WEATHER SAT'), omm(10, 'STATION')],
    { STATIONS: [10], WEATHER: [20], GEO: [20] },
    '2026-09-19T13:00:00Z',
  );

  assert.deepEqual(
    catalog.satellites.map(({ noradId, categories }) => ({ noradId, categories })),
    [
      { noradId: 10, categories: ['STATIONS'] },
      { noradId: 20, categories: ['WEATHER', 'GEO'] },
    ],
  );
  assert.equal(catalog.satellites[0].meanMotion, 15);

  const other = normalizeCatalog([omm(30, 'OTHER')], {}).satellites[0];
  assert.deepEqual(other.categories, ['OTHER']);
});

test('deduplicates NORAD IDs and keeps the newest OMM epoch', () => {
  const catalog = normalizeCatalog(
    [omm(25544, 'ISS OLD', '2026-09-18T12:00:00Z'), omm(25544, 'ISS NEW', '2026-09-19T12:00:00Z')],
    {},
  );

  assert.equal(catalog.satellites.length, 1);
  assert.equal(catalog.satellites[0].name, 'ISS NEW');
});

test('deduplicates group membership IDs', () => {
  assert.deepEqual(collectNoradIds([omm(1, 'A'), omm(1, 'A')]), [1]);
});
