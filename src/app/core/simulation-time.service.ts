import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { SimulationClockState } from '../models/simulation.model';

@Injectable({ providedIn: 'root' })
export class SimulationTimeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly wallClockStartedAtMs = Date.now();
  private readonly simulationStartedAtMs = this.wallClockStartedAtMs;
  private readonly state = signal<SimulationClockState>({
    currentTime: new Date(this.simulationStartedAtMs),
    mode: 'live',
    offsetMilliseconds: 0,
    speedMultiplier: 1,
  });

  readonly currentTime = computed(() => this.state().currentTime);

  constructor() {
    const timerId = window.setInterval(() => {
      this.state.update((state) => ({ ...state, currentTime: this.now() }));
    }, 1_000);

    this.destroyRef.onDestroy(() => window.clearInterval(timerId));
  }

  now(): Date {
    const state = this.state();
    if (state.mode === 'paused') {
      return new Date(state.currentTime);
    }

    const elapsedWallTimeMs = Date.now() - this.wallClockStartedAtMs;
    return new Date(
      this.simulationStartedAtMs +
        state.offsetMilliseconds +
        elapsedWallTimeMs * state.speedMultiplier,
    );
  }
}
