export const SIMULATION_SPEEDS = [1, 10, 100, 1_000, 10_000] as const;

export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number];
export type SimulationMode = 'live' | 'paused' | 'simulation';

export interface SimulationClockState {
  currentTime: Date;
  mode: SimulationMode;
  speedMultiplier: SimulationSpeed;
}
