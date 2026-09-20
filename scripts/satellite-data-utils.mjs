export const CATEGORY_ORDER = ['STATIONS', 'STARLINK', 'WEATHER', 'GPS', 'GALILEO', 'GEO'];

const REQUIRED_NUMBER_FIELDS = [
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
];

export function normalizeCatalog(
  activeRecords,
  memberships,
  generatedAt = new Date().toISOString(),
) {
  if (!Array.isArray(activeRecords)) {
    throw new Error('The active CelesTrak payload must be an array.');
  }

  const membershipSets = Object.fromEntries(
    CATEGORY_ORDER.map((category) => [category, new Set(memberships[category] ?? [])]),
  );
  const recordsByNoradId = new Map();

  for (const value of activeRecords) {
    const normalized = normalizeOmmRecord(value);
    const existing = recordsByNoradId.get(normalized.noradId);

    if (!existing || Date.parse(normalized.epoch) > Date.parse(existing.epoch)) {
      recordsByNoradId.set(normalized.noradId, normalized);
    }
  }

  const satellites = [...recordsByNoradId.values()]
    .sort((left, right) => left.noradId - right.noradId)
    .map((record) => {
      const categories = CATEGORY_ORDER.filter((category) =>
        membershipSets[category].has(record.noradId),
      );

      return {
        ...record,
        categories: categories.length > 0 ? categories : ['OTHER'],
      };
    });

  if (satellites.length === 0) {
    throw new Error('The active CelesTrak payload contained no usable satellites.');
  }

  return {
    version: 1,
    generatedAt,
    source: 'CelesTrak GP/OMM',
    satellites,
  };
}

export function collectNoradIds(groupRecords) {
  if (!Array.isArray(groupRecords)) {
    throw new Error('A CelesTrak group payload was not an array.');
  }

  const ids = new Set();
  for (const record of groupRecords) {
    if (!isRecord(record) || !isNumberLike(record.NORAD_CAT_ID)) {
      throw new Error('A CelesTrak group contains an invalid NORAD_CAT_ID.');
    }
    ids.add(Number(record.NORAD_CAT_ID));
  }
  return [...ids];
}

function normalizeOmmRecord(value) {
  if (!isRecord(value)) {
    throw new Error('CelesTrak returned an orbital entry that is not an object.');
  }

  if (typeof value.OBJECT_NAME !== 'string' || value.OBJECT_NAME.trim() === '') {
    throw new Error('CelesTrak returned an orbital entry without OBJECT_NAME.');
  }
  if (typeof value.EPOCH !== 'string' || !Number.isFinite(Date.parse(ensureUtc(value.EPOCH)))) {
    throw new Error(`CelesTrak returned an invalid EPOCH for ${value.OBJECT_NAME}.`);
  }

  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (!isNumberLike(value[field])) {
      throw new Error(`${value.OBJECT_NAME} is missing a valid ${field}.`);
    }
  }

  const epoch = ensureUtc(value.EPOCH);
  return {
    name: value.OBJECT_NAME.trim(),
    noradId: Number(value.NORAD_CAT_ID),
    objectId: typeof value.OBJECT_ID === 'string' ? value.OBJECT_ID.trim() : '',
    epoch,
    meanMotion: Number(value.MEAN_MOTION),
    eccentricity: Number(value.ECCENTRICITY),
    inclination: Number(value.INCLINATION),
    raan: Number(value.RA_OF_ASC_NODE),
    argPericenter: Number(value.ARG_OF_PERICENTER),
    meanAnomaly: Number(value.MEAN_ANOMALY),
    elementSetNo: Number(value.ELEMENT_SET_NO),
    revAtEpoch: isNumberLike(value.REV_AT_EPOCH) ? Number(value.REV_AT_EPOCH) : 0,
    bstar: Number(value.BSTAR),
    meanMotionDot: Number(value.MEAN_MOTION_DOT),
    meanMotionDdot: Number(value.MEAN_MOTION_DDOT),
  };
}

function ensureUtc(value) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberLike(value) {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  );
}
