export type SimulationMode = 'live' | 'paused';

export interface SimulationClockState {
  currentTime: Date;
  mode: SimulationMode;
  offsetMilliseconds: number;
  speedMultiplier: number;
}
