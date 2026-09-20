import { sunDirectionEarthFixed } from './sun-direction';

describe('sunDirectionEarthFixed', () => {
  it('returns a normalized Earth-fixed direction that changes with UTC time', () => {
    const first = sunDirectionEarthFixed(new Date('2026-09-20T00:00:00Z'));
    const later = sunDirectionEarthFixed(new Date('2026-09-20T06:00:00Z'));

    expect(Math.hypot(first.x, first.y, first.z)).toBeCloseTo(1, 10);
    expect(Math.hypot(later.x, later.y, later.z)).toBeCloseTo(1, 10);
    expect(Math.hypot(first.x - later.x, first.y - later.y, first.z - later.z)).toBeGreaterThan(1);
  });
});
