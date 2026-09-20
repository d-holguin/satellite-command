export interface PassSearchResult {
  status: 'PASS' | 'CONTINUOUS' | 'NONE';
  riseTimeMs: number | null;
  maxElevationTimeMs: number | null;
  maxElevationDeg: number | null;
  setTimeMs: number | null;
}

export interface PassSearchOptions {
  searchDurationMs?: number;
  coarseStepMs?: number;
  backwardSearchDurationMs?: number;
}

const DEFAULT_SEARCH_DURATION_MS = 48 * 60 * 60 * 1_000;
const DEFAULT_COARSE_STEP_MS = 60_000;
const DEFAULT_BACKWARD_SEARCH_DURATION_MS = 6 * 60 * 60 * 1_000;
const CROSSING_REFINEMENT_STEPS = 14;

/** Searches one elevation function without coupling the algorithm to SGP4. */
export function predictPassFromElevation(
  startTimeMs: number,
  elevationAt: (timestampMs: number) => number | null,
  options: PassSearchOptions = {},
): PassSearchResult {
  const durationMs = options.searchDurationMs ?? DEFAULT_SEARCH_DURATION_MS;
  const stepMs = options.coarseStepMs ?? DEFAULT_COARSE_STEP_MS;
  const backwardDurationMs =
    options.backwardSearchDurationMs ?? DEFAULT_BACKWARD_SEARCH_DURATION_MS;
  const endTimeMs = startTimeMs + durationMs;
  let previousTimeMs = startTimeMs;
  let previousElevation = elevationAt(previousTimeMs);
  if (previousElevation === null) return noPass();

  let riseTimeMs: number | null = previousElevation > 0 ? startTimeMs : null;
  let bestTimeMs = riseTimeMs;
  let bestElevation = riseTimeMs === null ? Number.NEGATIVE_INFINITY : previousElevation;
  let everBelow = previousElevation <= 0;

  if (previousElevation > 0) {
    let laterTimeMs = startTimeMs;
    for (
      let timeMs = startTimeMs - stepMs;
      timeMs >= startTimeMs - backwardDurationMs;
      timeMs -= stepMs
    ) {
      const elevation = elevationAt(timeMs);
      if (elevation === null) continue;
      if (elevation <= 0) {
        riseTimeMs = refineCrossing(timeMs, laterTimeMs, elevationAt);
        everBelow = true;
        break;
      }
      if (elevation > bestElevation) {
        bestElevation = elevation;
        bestTimeMs = timeMs;
      }
      laterTimeMs = timeMs;
    }
  }

  for (let timeMs = startTimeMs + stepMs; timeMs <= endTimeMs; timeMs += stepMs) {
    const elevation = elevationAt(timeMs);
    if (elevation === null) continue;
    if (elevation <= 0) everBelow = true;

    if (riseTimeMs === null && previousElevation <= 0 && elevation > 0) {
      riseTimeMs = refineCrossing(previousTimeMs, timeMs, elevationAt);
      bestTimeMs = timeMs;
      bestElevation = elevation;
    } else if (riseTimeMs !== null && elevation > bestElevation) {
      bestTimeMs = timeMs;
      bestElevation = elevation;
    }

    if (riseTimeMs !== null && previousElevation > 0 && elevation <= 0) {
      const setTimeMs = refineCrossing(previousTimeMs, timeMs, elevationAt);
      const refinedMaximum = refineMaximum(
        Math.max(riseTimeMs, (bestTimeMs ?? riseTimeMs) - stepMs),
        Math.min(setTimeMs, (bestTimeMs ?? setTimeMs) + stepMs),
        elevationAt,
      );
      return {
        status: 'PASS',
        riseTimeMs,
        maxElevationTimeMs: refinedMaximum.timeMs,
        maxElevationDeg: refinedMaximum.elevationDeg,
        setTimeMs,
      };
    }

    previousTimeMs = timeMs;
    previousElevation = elevation;
  }

  if (riseTimeMs !== null && !everBelow) {
    return {
      status: 'CONTINUOUS',
      riseTimeMs: null,
      maxElevationTimeMs: null,
      maxElevationDeg: bestElevation,
      setTimeMs: null,
    };
  }
  return noPass();
}

function refineCrossing(
  startTimeMs: number,
  endTimeMs: number,
  elevationAt: (timestampMs: number) => number | null,
): number {
  let low = startTimeMs;
  let high = endTimeMs;
  let lowElevation = elevationAt(low) ?? 0;
  for (let index = 0; index < CROSSING_REFINEMENT_STEPS; index += 1) {
    const middle = (low + high) / 2;
    const middleElevation = elevationAt(middle) ?? 0;
    if ((lowElevation <= 0 && middleElevation <= 0) || (lowElevation > 0 && middleElevation > 0)) {
      low = middle;
      lowElevation = middleElevation;
    } else {
      high = middle;
    }
  }
  return Math.round((low + high) / 2);
}

function refineMaximum(
  startTimeMs: number,
  endTimeMs: number,
  elevationAt: (timestampMs: number) => number | null,
): { timeMs: number; elevationDeg: number } {
  let bestTimeMs = startTimeMs;
  let bestElevation = Number.NEGATIVE_INFINITY;
  const samples = 24;
  for (let index = 0; index <= samples; index += 1) {
    const timeMs = startTimeMs + ((endTimeMs - startTimeMs) * index) / samples;
    const elevation = elevationAt(timeMs);
    if (elevation !== null && elevation > bestElevation) {
      bestElevation = elevation;
      bestTimeMs = timeMs;
    }
  }
  return { timeMs: Math.round(bestTimeMs), elevationDeg: bestElevation };
}

function noPass(): PassSearchResult {
  return {
    status: 'NONE',
    riseTimeMs: null,
    maxElevationTimeMs: null,
    maxElevationDeg: null,
    setTimeMs: null,
  };
}
