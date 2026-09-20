import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { SimulationClockState } from '../models/simulation.model';

@Injectable({ providedIn: 'root' })
export class SimulationTimeService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = signal<SimulationClockState>({
    currentTime: new Date(),
    mode: 'live',
    offsetMilliseconds: 0,
    speedMultiplier: 1,
  });

  readonly currentTime = computed(() => this.state().currentTime);
  constructor() {
    const timerId = window.setInterval(() => {
      this.state.update((state) => ({ ...state, currentTime: new Date() }));
    }, 1_000);

    this.destroyRef.onDestroy(() => window.clearInterval(timerId));
  }
}
