import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GeographicCoordinates } from '../models/geography.model';
import { SatelliteFilter, SatelliteRecord } from '../models/satellite.model';
import { latLonToWorldPosition, worldPositionToLatLon } from '../orbital/coordinate-converter';
import { matchesSatelliteFilter, primarySatelliteCategory } from '../orbital/satellite-catalog';
import { EarthTextureLoader } from './earth-texture-loader';

const EARTH_RADIUS = 1;
const RETICLE_INTERVAL_MS = 250;
const SHOW_GEOGRAPHIC_VALIDATION_MARKERS = false;
const GEOGRAPHIC_VALIDATION_LOCATIONS = [
  { name: 'Greenwich', latitudeDeg: 51.4779, longitudeDeg: 0 },
  { name: 'New York', latitudeDeg: 40.7, longitudeDeg: -74 },
  { name: 'Tokyo', latitudeDeg: 35.7, longitudeDeg: 139.7 },
  { name: 'Sydney', latitudeDeg: -33.9, longitudeDeg: 151.2 },
] as const;

const CATEGORY_COLORS = {
  STATIONS: new THREE.Color(0xeafcff),
  STARLINK: new THREE.Color(0x7fb8d4),
  WEATHER: new THREE.Color(0x75c6bb),
  GPS: new THREE.Color(0xd4c18a),
  GALILEO: new THREE.Color(0xb4c99a),
  GEO: new THREE.Color(0x9b91c6),
  OTHER: new THREE.Color(0xb7c6cf),
} as const;

interface SatelliteCloud {
  records: readonly SatelliteRecord[];
  positions: Float32Array;
  visibility: Float32Array;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

interface FocusTransition {
  startedAtMs: number;
  durationMs: number;
  cameraStart: THREE.Vector3;
  cameraEnd: THREE.Vector3;
  targetStart: THREE.Vector3;
  targetEnd: THREE.Vector3;
}

/**
 * Owns the Three.js lifecycle independently of Angular.
 *
 * World-space convention: Earth is centered at (0, 0, 0), radius is one, and
 * +Y is geographic north. Every satellite position already arrives in this
 * Earth-fixed frame from the orbit worker.
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
  private readonly pickingRaycaster = new THREE.Raycaster();
  private readonly reticleNdc = new THREE.Vector2(0, 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly selectedMarker: THREE.Group;
  private readonly selectedCoreGeometry = new THREE.SphereGeometry(1, 12, 12);
  private readonly selectedCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xf0fcff });
  private readonly selectedHaloGeometry = new THREE.SphereGeometry(1, 12, 12);
  private readonly selectedHaloMaterial = new THREE.MeshBasicMaterial({
    color: 0x65dfff,
    opacity: 0.18,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  private earthTexture?: THREE.Texture;
  private geographicValidationGroup?: THREE.Group;
  private geographicValidationGeometry?: THREE.SphereGeometry;
  private geographicValidationMaterial?: THREE.MeshBasicMaterial;
  private satelliteCloud?: SatelliteCloud;
  private orbitLine?: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private selectedIndex: number | null = null;
  private currentFilter: SatelliteFilter = 'ALL';
  private focusTransition?: FocusTransition;
  private pointerDownPosition?: { x: number; y: number };
  private animationFrameId: number | null = null;
  private lastReticleUpdateAtMs = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly satelliteLabel: HTMLElement,
    assetBaseUri: string,
    private readonly onReticleCoordinates?: (coordinates: GeographicCoordinates) => void,
    private readonly onSatelliteSelected?: (index: number | null) => void,
  ) {
    this.scene.background = new THREE.Color(0x020509);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 500);
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
    this.controls.maxDistance = EARTH_RADIUS * 100;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', this.cancelFocusTransition);

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
    this.viewLight.target.position.set(0, 0, 0);
    this.scene.add(this.viewLight, this.viewLight.target);
    this.updateViewLight();

    const core = new THREE.Mesh(this.selectedCoreGeometry, this.selectedCoreMaterial);
    const halo = new THREE.Mesh(this.selectedHaloGeometry, this.selectedHaloMaterial);
    core.name = 'Selected satellite core';
    halo.name = 'Selected satellite halo';
    this.selectedMarker = new THREE.Group();
    this.selectedMarker.add(halo, core);
    this.selectedMarker.visible = false;
    this.scene.add(this.selectedMarker);

    if (SHOW_GEOGRAPHIC_VALIDATION_MARKERS) this.addGeographicValidationMarkers();

    this.satelliteLabel.hidden = true;
    this.handleResize();
    window.addEventListener('resize', this.handleResize, { passive: true });
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    void this.loadEarthSurfaceTexture();
  }

  setSatelliteCatalog(records: readonly SatelliteRecord[], filter: SatelliteFilter): void {
    this.clearSatelliteCloud();

    const positions = new Float32Array(records.length * 3);
    positions.fill(Number.NaN);
    const colors = new Float32Array(records.length * 3);
    const visibility = new Float32Array(records.length);

    records.forEach((record, index) => {
      const color = CATEGORY_COLORS[primarySatelliteCategory(record)];
      color.toArray(colors, index * 3);
      visibility[index] = matchesSatelliteFilter(record, filter) ? 1 : 0;
    });

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('visibility', new THREE.BufferAttribute(visibility, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        pointSize: { value: 3.2 },
        pixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute vec3 color;
        attribute float visibility;
        varying vec3 vColor;
        varying float vVisibility;
        uniform float pointSize;
        uniform float pixelRatio;

        void main() {
          vColor = color;
          vVisibility = visibility;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          float distanceScale = 3.0 / max(-viewPosition.z, 0.1);
          gl_PointSize = clamp(pointSize * pixelRatio * distanceScale, 1.5 * pixelRatio, 5.0 * pixelRatio);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vVisibility;

        void main() {
          if (vVisibility < 0.5) discard;
          float radius = distance(gl_PointCoord, vec2(0.5));
          if (radius > 0.5) discard;
          float alpha = smoothstep(0.5, 0.22, radius) * 0.9;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'Active satellite catalog';
    points.frustumCulled = false;
    this.scene.add(points);

    this.currentFilter = filter;
    this.satelliteCloud = { records, positions, visibility, geometry, material, points };
  }

  updateSatellitePositions(nextPositions: Float32Array): void {
    const cloud = this.satelliteCloud;
    if (!cloud || nextPositions.length !== cloud.positions.length) return;

    cloud.positions.set(nextPositions);
    const attribute = cloud.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    this.updateSelectedMarkerPosition();
  }

  setFilter(filter: SatelliteFilter): void {
    this.currentFilter = filter;
    const cloud = this.satelliteCloud;
    if (!cloud) return;

    cloud.records.forEach((record, index) => {
      cloud.visibility[index] = matchesSatelliteFilter(record, filter) ? 1 : 0;
    });
    const attribute = cloud.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
  }

  selectSatellite(index: number | null): void {
    const cloud = this.satelliteCloud;
    this.selectedIndex = index;
    this.satelliteLabel.hidden = true;
    this.clearOrbitPath();

    if (index === null || !cloud?.records[index]) {
      this.selectedMarker.visible = false;
      return;
    }

    this.satelliteLabel.textContent = cloud.records[index].name;
    this.updateSelectedMarkerPosition();
  }

  setOrbitPath(positions: Float32Array | null): void {
    this.clearOrbitPath();
    if (!positions || positions.length < 6) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x76dff7,
      opacity: 0.48,
      transparent: true,
      depthWrite: false,
    });
    this.orbitLine = new THREE.Line(geometry, material);
    this.orbitLine.name = 'Selected satellite orbit';
    this.scene.add(this.orbitLine);
  }

  focusSatellite(index: number): void {
    const position = this.readSatellitePosition(index, new THREE.Vector3());
    if (!position) return;

    const radius = position.length();
    const direction = position.normalize();
    const targetDistance = Math.max(0, (radius - EARTH_RADIUS) / 2);
    const halfSpan = (radius + EARTH_RADIUS) / 2;
    const viewDistance = (halfSpan / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.2;

    this.focusTransition = {
      startedAtMs: performance.now(),
      durationMs: 1_100,
      cameraStart: this.camera.position.clone(),
      cameraEnd: direction.clone().multiplyScalar(targetDistance + viewDistance),
      targetStart: this.controls.target.clone(),
      targetEnd: direction.multiplyScalar(targetDistance),
    };
  }

  start(): void {
    if (this.disposed || this.animationFrameId !== null) return;
    this.animate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.controls.removeEventListener('start', this.cancelFocusTransition);

    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.clearSatelliteCloud();
    this.clearOrbitPath();
    this.controls.dispose();
    this.earthGeometry.dispose();
    this.earthMaterial.dispose();
    this.atmosphereGeometry.dispose();
    this.atmosphereMaterial.dispose();
    this.selectedCoreGeometry.dispose();
    this.selectedCoreMaterial.dispose();
    this.selectedHaloGeometry.dispose();
    this.selectedHaloMaterial.dispose();
    this.earthTexture?.dispose();
    this.disposeGeographicValidationMarkers();
    this.renderer.dispose();
  }

  private readonly animate = (): void => {
    if (this.disposed) return;

    this.controls.update();
    this.updateFocusTransition();
    this.updateViewLight();
    this.updateReticleLocation();
    this.updateSelectedVisual();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private updateSelectedMarkerPosition(): void {
    if (this.selectedIndex === null) return;
    const position = this.readSatellitePosition(this.selectedIndex, this.selectedMarker.position);
    this.selectedMarker.visible = Boolean(position);
  }

  private updateSelectedVisual(): void {
    if (!this.selectedMarker.visible) {
      this.satelliteLabel.hidden = true;
      return;
    }

    const distance = this.camera.position.distanceTo(this.selectedMarker.position);
    const coreScale = Math.max(0.014, distance * 0.0055);
    this.selectedMarker.children[0].scale.setScalar(coreScale * 2.4);
    this.selectedMarker.children[1].scale.setScalar(coreScale);

    this.projectedPosition.copy(this.selectedMarker.position).project(this.camera);
    const inView =
      this.projectedPosition.z >= -1 &&
      this.projectedPosition.z <= 1 &&
      Math.abs(this.projectedPosition.x) <= 1.1 &&
      Math.abs(this.projectedPosition.y) <= 1.1;
    const visible = inView && !this.isOccludedByEarth(this.selectedMarker.position);
    this.satelliteLabel.hidden = !visible;
    if (!visible) return;

    const x = (this.projectedPosition.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const y = (-this.projectedPosition.y * 0.5 + 0.5) * this.canvas.clientHeight;
    this.satelliteLabel.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 0.9rem))`;
  }

  private updateReticleLocation(): void {
    if (!this.onReticleCoordinates) return;
    const nowMs = performance.now();
    if (nowMs - this.lastReticleUpdateAtMs < RETICLE_INTERVAL_MS) return;
    this.lastReticleUpdateAtMs = nowMs;

    this.reticleRaycaster.setFromCamera(this.reticleNdc, this.camera);
    const intersection = this.reticleRaycaster.intersectObject(this.earthMesh, false)[0];
    if (intersection) this.onReticleCoordinates(worldPositionToLatLon(intersection.point));
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDownPosition = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDownPosition;
    this.pointerDownPosition = undefined;
    if (
      !start ||
      event.button !== 0 ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
    ) {
      return;
    }

    const cloud = this.satelliteCloud;
    if (!cloud) return;
    const bounds = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.pickingRaycaster.params.Points = {
      threshold: Math.max(0.025, this.camera.position.distanceTo(this.controls.target) * 0.006),
    };
    this.pickingRaycaster.setFromCamera(this.pointerNdc, this.camera);

    const intersections = this.pickingRaycaster.intersectObject(cloud.points, false);
    for (const intersection of intersections) {
      const index = intersection.index;
      if (
        index !== undefined &&
        cloud.visibility[index] > 0 &&
        !this.isOccludedByEarth(intersection.point)
      ) {
        this.onSatelliteSelected?.(index);
        return;
      }
    }
    this.onSatelliteSelected?.(null);
  };

  private readSatellitePosition(index: number, target: THREE.Vector3): THREE.Vector3 | null {
    const positions = this.satelliteCloud?.positions;
    const offset = index * 3;
    if (!positions || offset + 2 >= positions.length) return null;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    if (![x, y, z].every(Number.isFinite)) return null;
    return target.set(x, y, z);
  }

  private isOccludedByEarth(position: THREE.Vector3): boolean {
    this.sightLine.subVectors(position, this.camera.position);
    const a = this.sightLine.lengthSq();
    const b = 2 * this.camera.position.dot(this.sightLine);
    const c = this.camera.position.lengthSq() - EARTH_RADIUS * EARTH_RADIUS;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return false;
    const nearestIntersection = (-b - Math.sqrt(discriminant)) / (2 * a);
    return nearestIntersection > 0 && nearestIntersection < 1;
  }

  private updateFocusTransition(): void {
    const transition = this.focusTransition;
    if (!transition) return;
    const progress = Math.min(
      (performance.now() - transition.startedAtMs) / transition.durationMs,
      1,
    );
    const eased = progress * progress * (3 - 2 * progress);
    this.camera.position.lerpVectors(transition.cameraStart, transition.cameraEnd, eased);
    this.controls.target.lerpVectors(transition.targetStart, transition.targetEnd, eased);
    if (progress === 1) this.focusTransition = undefined;
  }

  private readonly cancelFocusTransition = (): void => {
    this.focusTransition = undefined;
  };

  private clearSatelliteCloud(): void {
    if (!this.satelliteCloud) return;
    this.scene.remove(this.satelliteCloud.points);
    this.satelliteCloud.geometry.dispose();
    this.satelliteCloud.material.dispose();
    this.satelliteCloud = undefined;
  }

  private clearOrbitPath(): void {
    if (!this.orbitLine) return;
    this.scene.remove(this.orbitLine);
    this.orbitLine.geometry.dispose();
    this.orbitLine.material.dispose();
    this.orbitLine = undefined;
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
    if (this.geographicValidationGroup) this.scene.remove(this.geographicValidationGroup);
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
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    if (this.satelliteCloud) this.satelliteCloud.material.uniforms['pixelRatio'].value = pixelRatio;
  };
}
