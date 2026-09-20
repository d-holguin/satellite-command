export interface ObserverLocation {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  accuracyMeters?: number;
}

export type ObserverLocationSource = 'browser' | 'manual';
export type ObserverStatus = 'disabled' | 'ready' | 'locating' | 'active' | 'error';
export type ElevationTrend = 'RISING' | 'SETTING' | 'NEAR MAX';

export interface ObserverSatelliteLook {
  index: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

export interface SelectedObserverLook extends ObserverSatelliteLook {
  direction: string;
  trend: ElevationTrend;
}

export type SatellitePassStatus = 'PASS' | 'CONTINUOUS' | 'NONE';

export interface SatellitePassPrediction {
  index: number;
  status: SatellitePassStatus;
  riseTime: Date | null;
  maxElevationTime: Date | null;
  maxElevationDeg: number | null;
  setTime: Date | null;
}
