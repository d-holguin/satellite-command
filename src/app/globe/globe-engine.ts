import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GeographicCoordinates } from '../models/geography.model';
import { SatelliteTelemetry } from '../models/satellite.model';
import { latLonToWorldPosition, worldPositionToLatLon } from '../orbital/coordinate-converter';
import { SatellitePropagator } from '../orbital/satellite-propagator';
import { EarthTextureLoader } from './earth-texture-loader';

const EARTH_RADIUS = 1;
const TELEMETRY_INTERVAL_MS = 1_000;
const RETICLE_INTERVAL_MS = 250;
const SHOW_GEOGRAPHIC_VALIDATION_MARKERS = false;
const GEOGRAPHIC_VALIDATION_LOCATIONS = [
  { name: 'Greenwich', latitudeDeg: 51.4779, longitudeDeg: 0 },
  { name: 'New York', latitudeDeg: 40.7, longitudeDeg: -74 },
  { name: 'Tokyo', latitudeDeg: 35.7, longitudeDeg: 139.7 },
  { name: 'Sydney', latitudeDeg: -33.9, longitudeDeg: 151.2 },
] as const;

interface SatelliteCallbacks {
  onTelemetry: (telemetry: SatelliteTelemetry) => void;
  onError: (error: unknown) => void;
}

interface SatelliteVisual {
  group: THREE.Group;
  coreGeometry: THREE.SphereGeometry;
  coreMaterial: THREE.MeshBasicMaterial;
  haloGeometry: THREE.SphereGeometry;
  haloMaterial: THREE.MeshBasicMaterial;
  propagator: SatellitePropagator;
  callbacks: SatelliteCallbacks;
  errorReported: boolean;
}

/**
 * Owns the Three.js lifecycle independently of Angular.
 *
 * World-space convention: Earth is centered at (0, 0, 0) and its radius is
 * one Three.js unit. Satellite distances are normalized against Earth's WGS84
 * equatorial radius before they enter the scene.
 */
export class GlobeEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly earthGeometry: THREE.SphereGeometry;
  private readonly earthMaterial: THREE.MeshStandardMaterial;
  private readonly earthMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly atmosphereGeometry: THREE.SphereGeometry;
  private readonly atmosphereMaterial: THREE.MeshBasicMaterial;
  private readonly earthTextureLoader: EarthTextureLoader;
  private readonly viewLight = new THREE.DirectionalLight(0xd8efff, 2.6);
  private readonly projectedPosition = new THREE.Vector3();
  private readonly sightLine = new THREE.Vector3();
  private readonly reticleRaycaster = new THREE.Raycaster();
  private readonly reticleNdc = new THREE.Vector2(0, 0);

  private earthTexture?: THREE.Texture;
  private geographicValidationGroup?: THREE.Group;
  private geographicValidationGeometry?: THREE.SphereGeometry;
  private geographicValidationMaterial?: THREE.MeshBasicMaterial;
  private satellite?: SatelliteVisual;
  private animationFrameId: number | null = null;
  private lastTelemetryAtMs = Number.NEGATIVE_INFINITY;
  private lastReticleUpdateAtMs = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly timeProvider: () => Date,
    private readonly satelliteLabel: HTMLElement,
    assetBaseUri: string,
    private readonly onReticleCoordinates?: (coordinates: GeographicCoordinates) => void,
  ) {
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
    this.earthTextureLoader = new EarthTextureLoader(this.renderer, assetBaseUri);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.autoRotate = false;
    this.controls.minAzimuthAngle = Number.NEGATIVE_INFINITY;
    this.controls.maxAzimuthAngle = Number.POSITIVE_INFINITY;
    this.controls.minDistance = EARTH_RADIUS * 1.2;
    this.controls.maxDistance = EARTH_RADIUS * 8;
    this.controls.target.set(0, 0, 0);

    this.earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    this.earthMaterial = new THREE.MeshStandardMaterial({
      color: 0x183247,
      roughness: 0.92,
      metalness: 0,
    });

    // SphereGeometry maps the texture's centered 0° longitude to +X and 90°E
    // to -Z, exactly matching ECF-to-world conversion. Geography stays fixed;
    // OrbitControls moves the camera rather than rotating Earth under satellites.
    this.earthMesh = new THREE.Mesh(this.earthGeometry, this.earthMaterial);
    this.scene.add(this.earthMesh);

    this.atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.035, 48, 48);
    this.atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x69b8dd,
      opacity: 0.075,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(this.atmosphereGeometry, this.atmosphereMaterial));

    this.scene.add(new THREE.AmbientLight(0x9bb0bd, 0.38));

    // Until astronomical Sun positioning is introduced, keep the directional
    // key light camera-relative so every inspected hemisphere remains legible.
    // Only lighting moves; Earth geography and satellite positions stay in ECF.
    this.viewLight.target.position.set(0, 0, 0);
    this.scene.add(this.viewLight, this.viewLight.target);
    this.updateViewLight();

    if (SHOW_GEOGRAPHIC_VALIDATION_MARKERS) {
      this.addGeographicValidationMarkers();
    }

    this.satelliteLabel.hidden = true;
    this.handleResize();
    window.addEventListener('resize', this.handleResize, { passive: true });
    void this.loadEarthSurfaceTexture();
  }

  setSatellite(propagator: SatellitePropagator, callbacks: SatelliteCallbacks): void {
    this.clearSatellite();

    const coreGeometry = new THREE.SphereGeometry(0.018, 16, 16);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xeafcff });
    const haloGeometry = new THREE.SphereGeometry(0.04, 16, 16);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x64dfff,
      opacity: 0.2,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const group = new THREE.Group();
    group.add(
      new THREE.Mesh(haloGeometry, haloMaterial),
      new THREE.Mesh(coreGeometry, coreMaterial),
    );
    this.scene.add(group);

    this.satellite = {
      group,
      coreGeometry,
      coreMaterial,
      haloGeometry,
      haloMaterial,
      propagator,
      callbacks,
      errorReported: false,
    };
    this.lastTelemetryAtMs = Number.NEGATIVE_INFINITY;
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

    this.clearSatellite();
    this.controls.dispose();
    this.earthGeometry.dispose();
    this.earthMaterial.dispose();
    this.atmosphereGeometry.dispose();
    this.atmosphereMaterial.dispose();
    this.earthTexture?.dispose();
    this.disposeGeographicValidationMarkers();
    this.renderer.dispose();
  }

  private readonly animate = (): void => {
    if (this.disposed) {
      return;
    }

    this.controls.update();
    this.updateViewLight();
    this.updateReticleLocation();
    this.updateSatellite();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private updateSatellite(): void {
    const satellite = this.satellite;
    if (!satellite || satellite.errorReported) {
      return;
    }

    try {
      const state = satellite.propagator.propagate(this.timeProvider());
      satellite.group.position.set(
        state.worldPosition.x,
        state.worldPosition.y,
        state.worldPosition.z,
      );

      this.updateSatelliteLabel(satellite.group.position);

      const nowMs = performance.now();
      if (nowMs - this.lastTelemetryAtMs >= TELEMETRY_INTERVAL_MS) {
        this.lastTelemetryAtMs = nowMs;
        satellite.callbacks.onTelemetry(state.telemetry);
      }
    } catch (error) {
      satellite.errorReported = true;
      satellite.group.visible = false;
      this.satelliteLabel.hidden = true;
      console.error('ISS propagation failed.', error);
      satellite.callbacks.onError(error);
    }
  }

  private updateReticleLocation(): void {
    if (!this.onReticleCoordinates) {
      return;
    }

    const nowMs = performance.now();
    if (nowMs - this.lastReticleUpdateAtMs < RETICLE_INTERVAL_MS) {
      return;
    }
    this.lastReticleUpdateAtMs = nowMs;

    // The screen-center reticle is a geographic cursor. Raycasting the fixed
    // Earth surface keeps this derived location in the same ECF-aligned frame
    // as satellite positions without coupling Angular to Three.js state.
    this.reticleRaycaster.setFromCamera(this.reticleNdc, this.camera);
    const intersection = this.reticleRaycaster.intersectObject(this.earthMesh, false)[0];
    if (intersection) {
      this.onReticleCoordinates(worldPositionToLatLon(intersection.point));
    }
  }

  private updateSatelliteLabel(position: THREE.Vector3): void {
    this.projectedPosition.copy(position).project(this.camera);

    const inView =
      this.projectedPosition.z >= -1 &&
      this.projectedPosition.z <= 1 &&
      Math.abs(this.projectedPosition.x) <= 1.1 &&
      Math.abs(this.projectedPosition.y) <= 1.1;
    const visible = inView && !this.isOccludedByEarth(position);

    this.satelliteLabel.hidden = !visible;
    if (!visible) {
      return;
    }

    const x = (this.projectedPosition.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const y = (-this.projectedPosition.y * 0.5 + 0.5) * this.canvas.clientHeight;
    this.satelliteLabel.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 0.9rem))`;
  }

  private isOccludedByEarth(position: THREE.Vector3): boolean {
    this.sightLine.subVectors(position, this.camera.position);

    const a = this.sightLine.lengthSq();
    const b = 2 * this.camera.position.dot(this.sightLine);
    const c = this.camera.position.lengthSq() - EARTH_RADIUS * EARTH_RADIUS;
    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      return false;
    }

    const nearestIntersection = (-b - Math.sqrt(discriminant)) / (2 * a);
    return nearestIntersection > 0 && nearestIntersection < 1;
  }

  private clearSatellite(): void {
    if (!this.satellite) {
      return;
    }

    this.scene.remove(this.satellite.group);
    this.satellite.coreGeometry.dispose();
    this.satellite.coreMaterial.dispose();
    this.satellite.haloGeometry.dispose();
    this.satellite.haloMaterial.dispose();
    this.satellite = undefined;
    this.satelliteLabel.hidden = true;
  }

  private async loadEarthSurfaceTexture(): Promise<void> {
    try {
      const texture = await this.earthTextureLoader.loadDayTexture();

      if (this.disposed) {
        texture.dispose();
        return;
      }

      this.earthTexture = texture;
      this.earthMaterial.map = texture;
      this.earthMaterial.color.setHex(0xd8e0e4);
      this.earthMaterial.needsUpdate = true;
    } catch (error) {
      console.error('Unable to load the Earth surface texture; using placeholder.', error);
    }
  }

  private addGeographicValidationMarkers(): void {
    const group = new THREE.Group();
    const geometry = new THREE.SphereGeometry(0.012, 12, 12);
    const material = new THREE.MeshBasicMaterial({ color: 0xffc857 });

    for (const location of GEOGRAPHIC_VALIDATION_LOCATIONS) {
      const position = latLonToWorldPosition(
        location.latitudeDeg,
        location.longitudeDeg,
        EARTH_RADIUS * 1.008,
      );
      const marker = new THREE.Mesh(geometry, material);
      marker.name = `Geographic validation: ${location.name}`;
      marker.position.set(position.x, position.y, position.z);
      group.add(marker);
    }

    this.geographicValidationGroup = group;
    this.geographicValidationGeometry = geometry;
    this.geographicValidationMaterial = material;
    this.scene.add(group);
  }

  private disposeGeographicValidationMarkers(): void {
    if (this.geographicValidationGroup) {
      this.scene.remove(this.geographicValidationGroup);
    }

    this.geographicValidationGeometry?.dispose();
    this.geographicValidationMaterial?.dispose();
  }

  private updateViewLight(): void {
    this.viewLight.position.copy(this.camera.position);
  }

  private readonly handleResize = (): void => {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
  };
}
