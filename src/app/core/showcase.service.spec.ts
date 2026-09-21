import { CAMERA_PRESETS } from '../globe/camera-presets';
import { VISUALIZATION_PRESETS } from './showcase.service';

describe('showcase presets', () => {
  it('provides each curated view exactly once', () => {
    const ids = VISUALIZATION_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'ORBITAL_OVERVIEW',
      'STARLINK_SWARM',
      'GPS_CONSTELLATION',
      'GEO_BELT',
      'ISS_TRACK',
      'TIME_WARP',
    ]);
  });

  it('routes every visualization through a reusable camera preset', () => {
    for (const preset of VISUALIZATION_PRESETS) {
      expect(CAMERA_PRESETS[preset.cameraPreset]).toBeDefined();
    }
  });

  it('keeps orbital scales ordered from Earth through GEO overview', () => {
    const distance = (id: keyof typeof CAMERA_PRESETS) =>
      Math.hypot(...CAMERA_PRESETS[id].position);

    expect(distance('EARTH')).toBeLessThan(distance('LEO'));
    expect(distance('LEO')).toBeLessThan(distance('MEO'));
    expect(distance('MEO')).toBeLessThan(distance('GEO'));
    expect(distance('GEO')).toBeLessThan(distance('OVERVIEW'));
  });

  it('uses the unified catalog entry for the ISS showcase', () => {
    const iss = VISUALIZATION_PRESETS.find((preset) => preset.id === 'ISS_TRACK');

    expect(iss?.targetNoradId).toBe(25544);
    expect(iss?.showOrbit).toBe(true);
    expect(iss?.groundTrack).toBe(true);
  });
});
