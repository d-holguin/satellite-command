import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_RADIUS = 1;

/**
 * Owns the Three.js lifecycle independently of Angular.
 *
 * World-space convention: Earth is centered at (0, 0, 0) and its radius is
 * one Three.js unit. Satellite distances will later be normalized against
 * Earth's real mean radius.
 */
export class GlobeEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly earthGeometry: THREE.SphereGeometry;
  private readonly earthMaterial: THREE.MeshStandardMaterial;
  private readonly atmosphereGeometry: THREE.SphereGeometry;
  private readonly atmosphereMaterial: THREE.MeshBasicMaterial;

  private animationFrameId: number | null = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x020509);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
    this.camera.position.set(0, 0.25, 3.25);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = EARTH_RADIUS * 1.2;
    this.controls.maxDistance = EARTH_RADIUS * 8;
    this.controls.target.set(0, 0, 0);

    this.earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    this.earthMaterial = new THREE.MeshStandardMaterial({
      color: 0x183247,
      roughness: 0.84,
      metalness: 0.08,
    });
    this.scene.add(new THREE.Mesh(this.earthGeometry, this.earthMaterial));

    this.atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.035, 48, 48);
    this.atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x69b8dd,
      opacity: 0.075,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(this.atmosphereGeometry, this.atmosphereMaterial));

    this.scene.add(new THREE.AmbientLight(0x7e9aad, 0.38));

    const sunlight = new THREE.DirectionalLight(0xd8efff, 3.2);
    sunlight.position.set(4, 2.5, 3);
    this.scene.add(sunlight);

    this.handleResize();
    window.addEventListener('resize', this.handleResize, { passive: true });
  }

  start(): void {
    if (this.disposed || this.animationFrameId !== null) {
      return;
    }

    this.animate();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.controls.dispose();
    this.earthGeometry.dispose();
    this.earthMaterial.dispose();
    this.atmosphereGeometry.dispose();
    this.atmosphereMaterial.dispose();
    this.renderer.dispose();
  }

  private readonly animate = (): void => {
    if (this.disposed) {
      return;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private readonly handleResize = (): void => {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
  };
}
