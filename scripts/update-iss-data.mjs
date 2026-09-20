import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ISS_NORAD_ID = 25544;
const ISS_QUERY_URL = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON';
const OUTPUT_PATH = fileURLToPath(new URL('../public/data/iss-omm.json', import.meta.url));

const REQUIRED_STRING_FIELDS = ['OBJECT_NAME', 'OBJECT_ID', 'EPOCH'];
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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberLike(value) {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  );
}

function assertUsableIssObject(value) {
  if (!isRecord(value)) {
    throw new Error('CelesTrak returned an entry that is not a JSON object.');
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw new Error(`CelesTrak response is missing a valid ${field}.`);
    }
  }

  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (!isNumberLike(value[field])) {
      throw new Error(`CelesTrak response is missing a valid ${field}.`);
    }
  }

  if (Number(value.NORAD_CAT_ID) !== ISS_NORAD_ID) {
    throw new Error(`Expected NORAD ${ISS_NORAD_ID}, received ${String(value.NORAD_CAT_ID)}.`);
  }

  if (!Number.isFinite(Date.parse(value.EPOCH))) {
    throw new Error(`CelesTrak returned an invalid EPOCH: ${value.EPOCH}.`);
  }
}

async function updateIssData() {
  const response = await fetch(ISS_QUERY_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`CelesTrak request failed with HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('CelesTrak did not return valid JSON.', { cause: error });
  }

  if (!Array.isArray(payload) || payload.length !== 1) {
    const count = Array.isArray(payload) ? payload.length : 'a non-array response';
    throw new Error(`Expected exactly one ISS object, received ${count}.`);
  }

  const iss = payload[0];
  assertUsableIssObject(iss);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(iss, null, 2)}\n`, 'utf8');

  console.log(`Updated ${OUTPUT_PATH} with ISS elements from ${iss.EPOCH}.`);
}

try {
  await updateIssData();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ISS data update failed: ${message}`);
  process.exitCode = 1;
}
