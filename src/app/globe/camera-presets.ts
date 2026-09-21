import { CameraPresetId } from '../models/visualization.model';

export interface CameraPreset {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  durationMs: number;
}

// Physical orbital distances remain unchanged; only the camera moves between
// these reusable presentation scales.
export const CAMERA_PRESETS: Readonly<Record<CameraPresetId, CameraPreset>> = {
  EARTH: {
    position: [2.05, 0.9, 1.75],
    target: [0, 0, 0],
    durationMs: 850,
  },
  LEO: {
    position: [2.8, 1.25, 2.65],
    target: [0, 0, 0],
    durationMs: 900,
  },
  MEO: {
    position: [7.9, 4.2, 7.2],
    target: [0, 0, 0],
    durationMs: 1_050,
  },
  GEO: {
    position: [13.1, 7.2, 12.2],
    target: [0, 0, 0],
    durationMs: 1_100,
  },
  OVERVIEW: {
    position: [15.5, 9.5, 17.5],
    target: [0, 0, 0],
    durationMs: 1_150,
  },
};
