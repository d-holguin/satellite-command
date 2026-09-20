import { predictPassFromElevation } from './pass-predictor';

describe('pass prediction', () => {
  it('detects rise, set, and maximum elevation', () => {
    const result = predictPassFromElevation(
      0,
      (timeMs) => 30 - Math.abs(timeMs / 1_000 - 120) / 2,
      { searchDurationMs: 300_000, coarseStepMs: 30_000 },
    );

    expect(result.status).toBe('PASS');
    expect(result.riseTimeMs).toBeCloseTo(60_000, -2);
    expect(result.setTimeMs).toBeCloseTo(180_000, -2);
    expect(result.maxElevationTimeMs).toBeCloseTo(120_000, -2);
    expect(result.maxElevationDeg).toBeCloseTo(30, 1);
  });

  it('returns no pass when elevation remains below the horizon', () => {
    expect(
      predictPassFromElevation(0, () => -12, {
        searchDurationMs: 300_000,
        coarseStepMs: 60_000,
      }).status,
    ).toBe('NONE');
  });

  it('recovers the rise and maximum for a pass already in progress', () => {
    const result = predictPassFromElevation(
      120_000,
      (timeMs) => 30 - Math.abs(timeMs / 1_000 - 120) / 2,
      {
        searchDurationMs: 180_000,
        coarseStepMs: 30_000,
        backwardSearchDurationMs: 180_000,
      },
    );
    expect(result.status).toBe('PASS');
    expect(result.riseTimeMs).toBeCloseTo(60_000, -2);
    expect(result.maxElevationTimeMs).toBeCloseTo(120_000, -2);
  });

  it('handles a continuously visible GEO-like object', () => {
    const result = predictPassFromElevation(0, () => 28, {
      searchDurationMs: 24 * 60 * 60 * 1_000,
      coarseStepMs: 60 * 60 * 1_000,
    });
    expect(result.status).toBe('CONTINUOUS');
    expect(result.setTimeMs).toBeNull();
  });
});
