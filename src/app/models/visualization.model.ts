import { SatelliteColorMode, SatelliteFilter } from './satellite.model';
import { SimulationSpeed } from './simulation.model';

export type CameraPresetId = 'EARTH' | 'LEO' | 'MEO' | 'GEO' | 'OVERVIEW';

export interface VisualizationPreset {
  id: string;
  label: string;
  description: string;
  filter?: SatelliteFilter;
  colorMode?: SatelliteColorMode;
  simulationSpeed?: SimulationSpeed;
  orbitalBands?: boolean;
  groundTrack?: boolean;
  showOrbit?: boolean;
  targetNoradId?: number;
  cameraPreset: CameraPresetId;
}

export interface CameraPresetRequest {
  preset: CameraPresetId;
  sequence: number;
}

export interface HoveredSatellite {
  index: number;
  altitudeKm: number;
}
