import {
  SATELLITE_CATEGORIES,
  SatelliteCatalog,
  SatelliteCategory,
  SatelliteFilter,
  SatelliteRecord,
  SatelliteSearchResult,
} from '../models/satellite.model';

const REQUIRED_NUMBER_FIELDS = [
  'noradId',
  'meanMotion',
  'eccentricity',
  'inclination',
  'raan',
  'argPericenter',
  'meanAnomaly',
  'elementSetNo',
  'revAtEpoch',
  'bstar',
  'meanMotionDot',
  'meanMotionDdot',
] as const;
const CATEGORY_SET = new Set<string>(SATELLITE_CATEGORIES);

export function parseSatelliteCatalog(value: unknown): SatelliteCatalog {
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['satellites'])) {
    throw new Error('The satellite catalog has an unsupported structure.');
  }

  const generatedAt = readString(value, 'generatedAt');
  const source = readString(value, 'source');
  if (!generatedAt || !Number.isFinite(Date.parse(generatedAt)) || !source) {
    throw new Error('The satellite catalog metadata is invalid.');
  }

  const satellites = value['satellites'].map(parseSatelliteRecord);
  const noradIds = new Set<number>();
  for (const satellite of satellites) {
    if (noradIds.has(satellite.noradId)) {
      throw new Error(`The satellite catalog contains duplicate NORAD ID ${satellite.noradId}.`);
    }
    noradIds.add(satellite.noradId);
  }

  return { version: 1, generatedAt, source, satellites };
}

export function matchesSatelliteFilter(
  satellite: SatelliteRecord,
  filter: SatelliteFilter,
): boolean {
  return filter === 'ALL' || satellite.categories.includes(filter);
}

export function filterSatelliteIndices(
  satellites: readonly SatelliteRecord[],
  filter: SatelliteFilter,
): number[] {
  const indices: number[] = [];
  satellites.forEach((satellite, index) => {
    if (matchesSatelliteFilter(satellite, filter)) {
      indices.push(index);
    }
  });
  return indices;
}

export function searchSatellites(
  satellites: readonly SatelliteRecord[],
  rawQuery: string,
  limit = 8,
): SatelliteSearchResult[] {
  const query = rawQuery.trim().toLocaleUpperCase();
  if (!query) {
    return [];
  }

  return satellites
    .map((satellite, index) => ({ satellite, index, rank: searchRank(satellite, query) }))
    .filter((result) => result.rank < Number.POSITIVE_INFINITY)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.satellite.name.localeCompare(right.satellite.name) ||
        left.satellite.noradId - right.satellite.noradId,
    )
    .slice(0, limit)
    .map(({ satellite, index }) => ({ satellite, index }));
}

export function primarySatelliteCategory(satellite: SatelliteRecord): SatelliteCategory {
  const precedence: readonly SatelliteCategory[] = [
    'STATIONS',
    'STARLINK',
    'GPS',
    'GALILEO',
    'WEATHER',
    'GEO',
    'OTHER',
  ];
  return precedence.find((category) => satellite.categories.includes(category)) ?? 'OTHER';
}

function searchRank(satellite: SatelliteRecord, query: string): number {
  const noradId = satellite.noradId.toString();
  const name = satellite.name.toLocaleUpperCase();
  if (noradId === query) return 0;
  if (name === query) return 1;
  if (name.startsWith(query)) return 2;
  if (noradId.startsWith(query)) return 3;
  if (name.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

function parseSatelliteRecord(value: unknown, index: number): SatelliteRecord {
  if (!isRecord(value)) {
    throw new Error(`Satellite record ${index} is not an object.`);
  }

  const name = readString(value, 'name');
  const objectId = readString(value, 'objectId', true);
  const epoch = readString(value, 'epoch');
  if (!name || objectId === null || !epoch || !Number.isFinite(Date.parse(epoch))) {
    throw new Error(`Satellite record ${index} has invalid identity fields.`);
  }

  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      throw new Error(`Satellite record ${index} has invalid ${field}.`);
    }
  }

  const rawCategories = value['categories'];
  if (
    !Array.isArray(rawCategories) ||
    rawCategories.length === 0 ||
    !rawCategories.every((category): category is SatelliteCategory =>
      typeof category === 'string' ? CATEGORY_SET.has(category) : false,
    )
  ) {
    throw new Error(`Satellite record ${index} has invalid categories.`);
  }

  return {
    name,
    objectId,
    epoch,
    noradId: value['noradId'] as number,
    meanMotion: value['meanMotion'] as number,
    eccentricity: value['eccentricity'] as number,
    inclination: value['inclination'] as number,
    raan: value['raan'] as number,
    argPericenter: value['argPericenter'] as number,
    meanAnomaly: value['meanAnomaly'] as number,
    elementSetNo: value['elementSetNo'] as number,
    revAtEpoch: value['revAtEpoch'] as number,
    bstar: value['bstar'] as number,
    meanMotionDot: value['meanMotionDot'] as number,
    meanMotionDdot: value['meanMotionDdot'] as number,
    categories: [...new Set(rawCategories)],
  };
}

function readString(
  record: Record<string, unknown>,
  key: string,
  allowEmpty = false,
): string | null {
  const value = record[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return allowEmpty || trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
