import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNoradIds, normalizeCatalog } from './satellite-data-utils.mjs';

const CELESTRAK_GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const OUTPUT_PATH = fileURLToPath(new URL('../public/data/satellites.json', import.meta.url));
const GROUPS = {
  ACTIVE: 'active',
  STATIONS: 'stations',
  STARLINK: 'starlink',
  WEATHER: 'weather',
  GEO: 'geo',
  GPS: 'gps-ops',
  GALILEO: 'galileo',
};

async function fetchGroup(group) {
  const url = new URL(CELESTRAK_GP_URL);
  url.searchParams.set('GROUP', group);
  url.searchParams.set('FORMAT', 'JSON');

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`CelesTrak group "${group}" failed with HTTP ${response.status}.`);
  }

  try {
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('response was not an array');
    }
    return payload;
  } catch (error) {
    throw new Error(`CelesTrak group "${group}" did not return valid JSON.`, { cause: error });
  }
}

async function updateSatelliteData() {
  const entries = await Promise.all(
    Object.entries(GROUPS).map(async ([category, group]) => [category, await fetchGroup(group)]),
  );
  const groups = Object.fromEntries(entries);
  const memberships = Object.fromEntries(
    Object.entries(groups)
      .filter(([category]) => category !== 'ACTIVE')
      .map(([category, records]) => [category, collectNoradIds(records)]),
  );
  const catalog = normalizeCatalog(groups.ACTIVE, memberships);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog)}\n`, 'utf8');

  const categoryCounts = Object.keys(memberships)
    .map(
      (category) =>
        `${category}=${catalog.satellites.filter((satellite) => satellite.categories.includes(category)).length}`,
    )
    .join(', ');
  console.log(`Updated ${OUTPUT_PATH}`);
  console.log(`Active satellites: ${catalog.satellites.length}; ${categoryCounts}`);
}

try {
  await updateSatelliteData();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Satellite data update failed: ${message}`);
  process.exitCode = 1;
}
