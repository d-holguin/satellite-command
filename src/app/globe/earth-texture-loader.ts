import * as THREE from 'three';

const EARTH_DAY_TEXTURE_4K_PATH = 'textures/earth/earth-day.jpg';
const EARTH_DAY_TEXTURE_8K_PATH = 'textures/earth/earth-day-8k.jpg';
const EARTH_DAY_TEXTURE_16K_PATH = 'textures/earth/earth-day-16k.jpg';
const MAX_ANISOTROPY = 8;
const EIGHT_K_TEXTURE_WIDTH = 8_192;
const SIXTEEN_K_TEXTURE_WIDTH = 16_384;

export class EarthTextureLoader {
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assetBaseUri: string,
  ) {}

  async loadDayTexture(): Promise<THREE.Texture> {
    const maxTextureSize = this.renderer.capabilities.maxTextureSize;
    const candidates = [
      { minimumSize: SIXTEEN_K_TEXTURE_WIDTH, path: EARTH_DAY_TEXTURE_16K_PATH, label: '16K' },
      { minimumSize: EIGHT_K_TEXTURE_WIDTH, path: EARTH_DAY_TEXTURE_8K_PATH, label: '8K' },
    ];

    for (const candidate of candidates) {
      if (maxTextureSize < candidate.minimumSize) continue;
      try {
        return await this.loadTexture(candidate.path);
      } catch (error) {
        console.warn(
          `Unable to load the ${candidate.label} Earth texture; trying a fallback.`,
          error,
        );
      }
    }

    return this.loadTexture(EARTH_DAY_TEXTURE_4K_PATH);
  }

  private async loadTexture(path: string): Promise<THREE.Texture> {
    const textureUrl = new URL(path, this.assetBaseUri);
    const texture = await this.loader.loadAsync(textureUrl.href);

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), MAX_ANISOTROPY);

    return texture;
  }
}
