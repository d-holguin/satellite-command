import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { SimulationTimeService } from './simulation-time.service';

describe('SimulationTimeService', () => {
  let service: SimulationTimeService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'));
    TestBed.configureTestingModule({});
    service = TestBed.inject(SimulationTimeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('tracks wall time without accumulating timer increments in live mode', () => {
    vi.setSystemTime(new Date('2026-09-20T00:00:12.345Z'));

    expect(service.now().toISOString()).toBe('2026-09-20T00:00:12.345Z');
    expect(service.mode()).toBe('live');
  });

  it.each([10, 100, 1_000, 10_000] as const)('advances at %sx from its time anchor', (speed) => {
    service.setSpeed(speed);
    vi.advanceTimersByTime(2_000);

    expect(service.now().getTime()).toBe(Date.parse('2026-09-20T00:00:00Z') + 2_000 * speed);
    expect(service.mode()).toBe('simulation');
  });

  it('holds simulation time while paused and resumes from the held instant', () => {
    service.setSpeed(100);
    vi.advanceTimersByTime(1_000);
    service.pause();
    const pausedAt = service.now().getTime();
    vi.advanceTimersByTime(30_000);

    expect(service.now().getTime()).toBe(pausedAt);
    expect(service.mode()).toBe('paused');

    service.resume();
    vi.advanceTimersByTime(500);
    expect(service.now().getTime()).toBe(pausedAt + 50_000);
  });

  it('returns to current UTC time at 1x', () => {
    service.setSpeed(1_000);
    vi.advanceTimersByTime(5_000);
    service.returnToLive();

    expect(service.mode()).toBe('live');
    expect(service.speedMultiplier()).toBe(1);
    expect(service.now().getTime()).toBe(Date.now());
  });
});
