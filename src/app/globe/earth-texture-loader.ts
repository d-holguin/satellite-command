import * as THREE from 'three';

const EARTH_DAY_TEXTURE_PATH = 'textures/earth/earth-day.jpg';
const MAX_ANISOTROPY = 8;

export class EarthTextureLoader {
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly assetBaseUri: string,
  ) {}

  async loadDayTexture(): Promise<THREE.Texture> {
    const textureUrl = new URL(EARTH_DAY_TEXTURE_PATH, this.assetBaseUri);
    const texture = await this.loader.loadAsync(textureUrl.href);

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), MAX_ANISOTROPY);

    return texture;
  }
}
