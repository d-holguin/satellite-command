import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  SIMULATION_SPEEDS,
  SimulationClockState,
  SimulationMode,
  SimulationSpeed,
} from '../models/simulation.model';

interface ClockAnchor {
  simulationBaseTimeMs: number;
  realBaseTimeMs: number;
  mode: SimulationMode;
  speedMultiplier: SimulationSpeed;
}

const CLOCK_DISPLAY_INTERVAL_MS = 200;

@Injectable({ providedIn: 'root' })
export class SimulationTimeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly anchorState = signal<ClockAnchor>({
    simulationBaseTimeMs: Date.now(),
    realBaseTimeMs: Date.now(),
    mode: 'live',
    speedMultiplier: 1,
  });
  private readonly displayTimeState = signal(this.now());

  readonly currentTime = this.displayTimeState.asReadonly();
  readonly mode = computed(() => this.anchorState().mode);
  readonly speedMultiplier = computed(() => this.anchorState().speedMultiplier);
  readonly isLive = computed(() => this.anchorState().mode === 'live');
  readonly state = computed<SimulationClockState>(() => ({
    currentTime: this.displayTimeState(),
    mode: this.anchorState().mode,
    speedMultiplier: this.anchorState().speedMultiplier,
  }));

  constructor() {
    const timerId = window.setInterval(() => {
      this.displayTimeState.set(this.now());
    }, CLOCK_DISPLAY_INTERVAL_MS);

    this.destroyRef.onDestroy(() => window.clearInterval(timerId));
  }

  now(): Date {
    const anchor = this.anchorState();
    if (anchor.mode === 'live') return new Date();
    if (anchor.mode === 'paused') return new Date(anchor.simulationBaseTimeMs);

    const elapsedRealMs = Date.now() - anchor.realBaseTimeMs;
    return new Date(anchor.simulationBaseTimeMs + elapsedRealMs * anchor.speedMultiplier);
  }

  setSpeed(speedMultiplier: SimulationSpeed): void {
    if (!SIMULATION_SPEEDS.includes(speedMultiplier)) {
      throw new Error(`Unsupported simulation speed: ${speedMultiplier}`);
    }

    const simulationBaseTimeMs = this.now().getTime();
    const realBaseTimeMs = Date.now();
    this.anchorState.set({
      simulationBaseTimeMs,
      realBaseTimeMs,
      mode: speedMultiplier === 1 && this.anchorState().mode === 'live' ? 'live' : 'simulation',
      speedMultiplier,
    });
    this.displayTimeState.set(this.now());
  }

  pause(): void {
    if (this.anchorState().mode === 'paused') return;
    const simulationBaseTimeMs = this.now().getTime();
    this.anchorState.update((anchor) => ({
      ...anchor,
      simulationBaseTimeMs,
      realBaseTimeMs: Date.now(),
      mode: 'paused',
    }));
    this.displayTimeState.set(new Date(simulationBaseTimeMs));
  }

  resume(): void {
    const anchor = this.anchorState();
    if (anchor.mode !== 'paused') return;
    this.anchorState.set({ ...anchor, realBaseTimeMs: Date.now(), mode: 'simulation' });
    this.displayTimeState.set(this.now());
  }

  togglePause(): void {
    if (this.anchorState().mode === 'paused') this.resume();
    else this.pause();
  }

  returnToLive(): void {
    const nowMs = Date.now();
    this.anchorState.set({
      simulationBaseTimeMs: nowMs,
      realBaseTimeMs: nowMs,
      mode: 'live',
      speedMultiplier: 1,
    });
    this.displayTimeState.set(new Date(nowMs));
  }
}
