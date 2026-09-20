import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GeographicCoordinates } from '../models/geography.model';
import { ObserverLocation, SelectedObserverLook } from '../models/observer.model';
import { SatelliteColorMode, SatelliteFilter, SatelliteRecord } from '../models/satellite.model';
import {
  EARTH_EQUATORIAL_RADIUS_KM,
  latLonToWorldPosition,
  worldPositionToLatLon,
} from '../orbital/coordinate-converter';
import { matchesSatelliteFilter, primarySatelliteCategory } from '../orbital/satellite-catalog';
import {
  observerLocationToWorldPosition,
  visibilityFootprintCentralAngle,
} from '../orbital/observer-geometry';
import { sunDirectionEarthFixed } from '../orbital/sun-direction';
import { EarthTextureLoader } from './earth-texture-loader';

const EARTH_RADIUS = 1;
const RETICLE_INTERVAL_MS = 250;
const SHOW_GEOGRAPHIC_VALIDATION_MARKERS = false;
const REFERENCE_ALTITUDES_KM = [500, 2_000, 20_200, 35_786] as const;
const FOOTPRINT_SEGMENTS = 128;
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
  colors: Float32Array;
  visibility: Float32Array;
  aboveHorizon: Uint8Array;
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
  private readonly sunLight = new THREE.DirectionalLight(0xfff4df, 1.15);
  private readonly viewLight = new THREE.DirectionalLight(0xc5e2ef, 1.35);
  private readonly projectedPosition = new THREE.Vector3();
  private readonly sightLine = new THREE.Vector3();
  private readonly reticleRaycaster = new THREE.Raycaster();
  private readonly pickingRaycaster = new THREE.Raycaster();
  private readonly reticleNdc = new THREE.Vector2(0, 0);
  private readonly pointerNdc = new THREE.Vector2();
  private readonly followTarget = new THREE.Vector3();
  private readonly followDelta = new THREE.Vector3();
  private readonly selectedSurfacePosition = new THREE.Vector3();
  private readonly observerPosition = new THREE.Vector3();
  private readonly footprintNormal = new THREE.Vector3();
  private readonly footprintTangent = new THREE.Vector3();
  private readonly footprintBitangent = new THREE.Vector3();
  private readonly footprintPoint = new THREE.Vector3();
  private readonly footprintReference = new THREE.Vector3();
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
  private readonly selectedSurfaceGeometry = new THREE.SphereGeometry(0.008, 10, 10);
  private readonly selectedSurfaceMaterial = new THREE.MeshBasicMaterial({ color: 0x6edcf6 });
  private readonly altitudeLineGeometry = new THREE.BufferGeometry();
  private readonly altitudeLineMaterial = new THREE.LineBasicMaterial({
    color: 0x72dff7,
    opacity: 0.34,
    transparent: true,
    depthWrite: false,
  });
  private readonly selectedSurfaceMarker: THREE.Mesh;
  private readonly altitudeLine: THREE.Line;
  private readonly referenceOrbitGroup = new THREE.Group();
  private readonly observerMarkerGeometry = new THREE.OctahedronGeometry(0.018, 0);
  private readonly observerMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffca70 });
  private readonly observerMarker = new THREE.Mesh(
    this.observerMarkerGeometry,
    this.observerMarkerMaterial,
  );
  private readonly observerZenithGeometry = new THREE.BufferGeometry();
  private readonly observerZenithMaterial = new THREE.LineBasicMaterial({
    color: 0xffca70,
    opacity: 0.32,
    transparent: true,
    depthWrite: false,
  });
  private readonly observerZenithLine: THREE.Line;
  private readonly lineOfSightGeometry = new THREE.BufferGeometry();
  private readonly lineOfSightMaterial = new THREE.LineBasicMaterial({
    color: 0xffd58a,
    opacity: 0.52,
    transparent: true,
    depthWrite: false,
  });
  private readonly lineOfSight: THREE.Line;
  private readonly footprintGeometry = new THREE.BufferGeometry();
  private readonly footprintMaterial = new THREE.LineBasicMaterial({
    color: 0xf0c475,
    opacity: 0.48,
    transparent: true,
    depthWrite: false,
  });
  private readonly footprintLine: THREE.LineLoop;

  private earthTexture?: THREE.Texture;
  private geographicValidationGroup?: THREE.Group;
  private geographicValidationGeometry?: THREE.SphereGeometry;
  private geographicValidationMaterial?: THREE.MeshBasicMaterial;
  private satelliteCloud?: SatelliteCloud;
  private orbitLine?: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private groundTrackLine?: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private selectedIndex: number | null = null;
  private currentFilter: SatelliteFilter = 'ALL';
  private colorMode: SatelliteColorMode = 'CATEGORY';
  private observerAboveOnly = false;
  private selectedAboveHorizon = false;
  private footprintEnabled = false;
  private followEnabled = false;
  private focusTransition?: FocusTransition;
  private pointerDownPosition?: { x: number; y: number };
  private animationFrameId: number | null = null;
  private lastReticleUpdateAtMs = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly satelliteLabel: HTMLElement,
    assetBaseUri: string,
    initialSimulationTime: Date,
    private readonly onReticleCoordinates?: (coordinates: GeographicCoordinates) => void,
    private readonly onSatelliteSelected?: (index: number | null) => void,
    private readonly onFollowExited?: () => void,
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
    this.controls.addEventListener('start', this.handleControlsStart);

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

    // Readability takes priority over a physically black night hemisphere. The
    // simulation-driven Sun remains a moving highlight while fill light keeps
    // every visible longitude legible.
    this.scene.add(new THREE.AmbientLight(0xb2c4ce, 0.5));
    this.sunLight.target.position.set(0, 0, 0);
    this.viewLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight, this.sunLight.target, this.viewLight, this.viewLight.target);
    this.setSimulationTime(initialSimulationTime);
    this.updateViewLight();

    const core = new THREE.Mesh(this.selectedCoreGeometry, this.selectedCoreMaterial);
    const halo = new THREE.Mesh(this.selectedHaloGeometry, this.selectedHaloMaterial);
    core.name = 'Selected satellite core';
    halo.name = 'Selected satellite halo';
    this.selectedMarker = new THREE.Group();
    this.selectedMarker.add(halo, core);
    this.selectedMarker.visible = false;
    this.scene.add(this.selectedMarker);

    this.selectedSurfaceMarker = new THREE.Mesh(
      this.selectedSurfaceGeometry,
      this.selectedSurfaceMaterial,
    );
    this.altitudeLineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.altitudeLine = new THREE.Line(this.altitudeLineGeometry, this.altitudeLineMaterial);
    this.altitudeLine.frustumCulled = false;
    this.selectedSurfaceMarker.visible = false;
    this.altitudeLine.visible = false;
    this.scene.add(this.selectedSurfaceMarker, this.altitudeLine);

    this.createReferenceOrbits();
    this.referenceOrbitGroup.visible = false;
    this.scene.add(this.referenceOrbitGroup);

    this.observerMarker.name = 'Observer location';
    this.observerMarker.visible = false;
    this.observerZenithGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.observerZenithLine = new THREE.Line(
      this.observerZenithGeometry,
      this.observerZenithMaterial,
    );
    this.observerZenithLine.frustumCulled = false;
    this.observerZenithLine.visible = false;

    this.lineOfSightGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.lineOfSight = new THREE.Line(this.lineOfSightGeometry, this.lineOfSightMaterial);
    this.lineOfSight.frustumCulled = false;
    this.lineOfSight.visible = false;

    this.footprintGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(FOOTPRINT_SEGMENTS * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.footprintLine = new THREE.LineLoop(this.footprintGeometry, this.footprintMaterial);
    this.footprintLine.frustumCulled = false;
    this.footprintLine.visible = false;
    this.scene.add(
      this.observerMarker,
      this.observerZenithLine,
      this.lineOfSight,
      this.footprintLine,
    );

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
    const aboveHorizon = new Uint8Array(records.length);

    records.forEach((record, index) => {
      const color = CATEGORY_COLORS[primarySatelliteCategory(record)];
      color.toArray(colors, index * 3);
      visibility[index] = matchesSatelliteFilter(record, filter) ? 1 : 0;
    });

    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', colorAttribute);
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
    this.satelliteCloud = {
      records,
      positions,
      colors,
      visibility,
      aboveHorizon,
      geometry,
      material,
      points,
    };
  }

  updateSatellitePositions(nextPositions: Float32Array): void {
    const cloud = this.satelliteCloud;
    if (!cloud || nextPositions.length !== cloud.positions.length) return;

    cloud.positions.set(nextPositions);
    const attribute = cloud.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    if (this.colorMode === 'ALTITUDE') this.updateAltitudeColors();
    this.updateSelectedMarkerPosition();
    this.updateObserverVisuals();
  }

  setFilter(filter: SatelliteFilter): void {
    this.currentFilter = filter;
    this.applySatelliteVisibility();
  }

  setObserverLocation(location: ObserverLocation | null): void {
    const visible = location !== null;
    this.observerMarker.visible = visible;
    this.observerZenithLine.visible = visible;
    if (!location) {
      this.observerAboveOnly = false;
      this.lineOfSight.visible = false;
      this.footprintLine.visible = false;
      this.applySatelliteVisibility();
      return;
    }

    const surfaceRadius = EARTH_RADIUS + location.altitudeKm / EARTH_EQUATORIAL_RADIUS_KM + 0.008;
    const position = observerLocationToWorldPosition(location, 0.008);
    this.observerPosition.set(position.x, position.y, position.z);
    this.observerMarker.position.copy(this.observerPosition);

    const zenithStart = this.observerPosition.clone();
    const zenithEnd = this.observerPosition
      .clone()
      .normalize()
      .multiplyScalar(surfaceRadius + 0.09);
    const zenithPositions = this.observerZenithGeometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    zenithPositions.setXYZ(0, zenithStart.x, zenithStart.y, zenithStart.z);
    zenithPositions.setXYZ(1, zenithEnd.x, zenithEnd.y, zenithEnd.z);
    zenithPositions.needsUpdate = true;
    this.updateObserverVisuals();
  }

  setObserverAboveOnly(enabled: boolean): void {
    this.observerAboveOnly = enabled && this.observerMarker.visible;
    this.applySatelliteVisibility();
  }

  updateAboveHorizonIndices(indices: readonly number[]): void {
    const cloud = this.satelliteCloud;
    if (!cloud) return;
    cloud.aboveHorizon.fill(0);
    for (const index of indices) {
      if (index >= 0 && index < cloud.aboveHorizon.length) cloud.aboveHorizon[index] = 1;
    }
    if (this.observerAboveOnly) this.applySatelliteVisibility();
  }

  setSelectedObserverLook(look: SelectedObserverLook | null): void {
    this.selectedAboveHorizon = Boolean(look && look.elevationDeg > 0);
    this.updateObserverVisuals();
  }

  setVisibilityFootprintVisible(visible: boolean): void {
    this.footprintEnabled = visible;
    this.updateVisibilityFootprint();
  }

  setColorMode(mode: SatelliteColorMode): void {
    if (this.colorMode === mode) return;
    this.colorMode = mode;
    if (mode === 'ALTITUDE') this.updateAltitudeColors();
    else this.updateCategoryColors();
  }

  setReferenceOrbitsVisible(visible: boolean): void {
    this.referenceOrbitGroup.visible = visible;
  }

  setSimulationTime(timestamp: Date): void {
    const direction = sunDirectionEarthFixed(timestamp);
    this.sunLight.position.set(direction.x, direction.y, direction.z).multiplyScalar(10);
  }

  selectSatellite(index: number | null): void {
    const cloud = this.satelliteCloud;
    this.selectedIndex = index;
    this.selectedAboveHorizon = false;
    this.satelliteLabel.hidden = true;
    this.clearOrbitPath();
    this.clearGroundTrack();
    this.setGroundContextVisible(false);

    if (index === null || !cloud?.records[index]) {
      this.selectedMarker.visible = false;
      this.lineOfSight.visible = false;
      this.footprintLine.visible = false;
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

  setGroundTrack(positions: Float32Array | null): void {
    this.clearGroundTrack();
    if (!positions || positions.length < 6) {
      this.setGroundContextVisible(false);
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x6acde4,
      opacity: 0.56,
      transparent: true,
      depthWrite: false,
    });
    this.groundTrackLine = new THREE.Line(geometry, material);
    this.groundTrackLine.name = 'Selected satellite ground track';
    this.scene.add(this.groundTrackLine);
    this.setGroundContextVisible(true);
    this.updateSelectedSurfaceVisual();
  }

  setFollowEnabled(enabled: boolean): void {
    const canFollow = enabled && this.selectedIndex !== null;
    if (canFollow && !this.followEnabled && this.selectedIndex !== null) {
      this.focusSatellite(this.selectedIndex);
    }
    this.followEnabled = canFollow;
  }

  cancelCameraMotion(): void {
    this.focusTransition = undefined;
    this.followEnabled = false;
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
    this.controls.removeEventListener('start', this.handleControlsStart);

    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.clearSatelliteCloud();
    this.clearOrbitPath();
    this.clearGroundTrack();
    this.controls.dispose();
    this.earthGeometry.dispose();
    this.earthMaterial.dispose();
    this.atmosphereGeometry.dispose();
    this.atmosphereMaterial.dispose();
    this.selectedCoreGeometry.dispose();
    this.selectedCoreMaterial.dispose();
    this.selectedHaloGeometry.dispose();
    this.selectedHaloMaterial.dispose();
    this.selectedSurfaceGeometry.dispose();
    this.selectedSurfaceMaterial.dispose();
    this.altitudeLineGeometry.dispose();
    this.altitudeLineMaterial.dispose();
    this.observerMarkerGeometry.dispose();
    this.observerMarkerMaterial.dispose();
    this.observerZenithGeometry.dispose();
    this.observerZenithMaterial.dispose();
    this.lineOfSightGeometry.dispose();
    this.lineOfSightMaterial.dispose();
    this.footprintGeometry.dispose();
    this.footprintMaterial.dispose();
    for (const child of this.referenceOrbitGroup.children) {
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
    this.earthTexture?.dispose();
    this.disposeGeographicValidationMarkers();
    this.renderer.dispose();
  }

  private readonly animate = (): void => {
    if (this.disposed) return;

    this.controls.update();
    this.updateFocusTransition();
    this.updateFollow();
    this.updateViewLight();
    this.updateReticleLocation();
    this.updateSelectedVisual();
    this.updateObserverMarkerScale();
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  private updateSelectedMarkerPosition(): void {
    if (this.selectedIndex === null) return;
    const position = this.readSatellitePosition(this.selectedIndex, this.selectedMarker.position);
    this.selectedMarker.visible = Boolean(position);
    if (!position) this.setGroundContextVisible(false);
    this.updateSelectedSurfaceVisual();
  }

  private updateSelectedSurfaceVisual(): void {
    if (!this.groundTrackLine || !this.selectedMarker.visible) {
      this.setGroundContextVisible(false);
      return;
    }
    this.setGroundContextVisible(true);
    this.selectedSurfacePosition
      .copy(this.selectedMarker.position)
      .normalize()
      .multiplyScalar(1.003);
    this.selectedSurfaceMarker.position.copy(this.selectedSurfacePosition);

    const positions = this.altitudeLineGeometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(
      0,
      this.selectedSurfacePosition.x,
      this.selectedSurfacePosition.y,
      this.selectedSurfacePosition.z,
    );
    positions.setXYZ(
      1,
      this.selectedMarker.position.x,
      this.selectedMarker.position.y,
      this.selectedMarker.position.z,
    );
    positions.needsUpdate = true;
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

  private updateObserverVisuals(): void {
    const hasObserver = this.observerMarker.visible;
    const hasSatellite = this.selectedMarker.visible && this.selectedIndex !== null;
    this.lineOfSight.visible = hasObserver && hasSatellite && this.selectedAboveHorizon;
    if (this.lineOfSight.visible) {
      const positions = this.lineOfSightGeometry.getAttribute('position') as THREE.BufferAttribute;
      positions.setXYZ(
        0,
        this.observerPosition.x,
        this.observerPosition.y,
        this.observerPosition.z,
      );
      positions.setXYZ(
        1,
        this.selectedMarker.position.x,
        this.selectedMarker.position.y,
        this.selectedMarker.position.z,
      );
      positions.needsUpdate = true;
    }
    this.updateVisibilityFootprint();
  }

  private updateVisibilityFootprint(): void {
    if (!this.footprintEnabled || !this.selectedMarker.visible || this.selectedIndex === null) {
      this.footprintLine.visible = false;
      return;
    }

    const satelliteRadius = this.selectedMarker.position.length();
    const altitudeKm = Math.max(0, (satelliteRadius - EARTH_RADIUS) * EARTH_EQUATORIAL_RADIUS_KM);
    const centralAngle = visibilityFootprintCentralAngle(altitudeKm, EARTH_EQUATORIAL_RADIUS_KM);
    const cosine = Math.cos(centralAngle);
    const sine = Math.sin(centralAngle);
    this.footprintNormal.copy(this.selectedMarker.position).normalize();
    this.footprintReference.set(
      Math.abs(this.footprintNormal.y) < 0.9 ? 0 : 1,
      Math.abs(this.footprintNormal.y) < 0.9 ? 1 : 0,
      0,
    );
    this.footprintTangent.crossVectors(this.footprintReference, this.footprintNormal).normalize();
    this.footprintBitangent.crossVectors(this.footprintNormal, this.footprintTangent).normalize();

    const positions = this.footprintGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < FOOTPRINT_SEGMENTS; index += 1) {
      const angle = (index / FOOTPRINT_SEGMENTS) * Math.PI * 2;
      this.footprintPoint
        .copy(this.footprintNormal)
        .multiplyScalar(cosine)
        .addScaledVector(this.footprintTangent, Math.cos(angle) * sine)
        .addScaledVector(this.footprintBitangent, Math.sin(angle) * sine)
        .multiplyScalar(1.004);
      positions.setXYZ(index, this.footprintPoint.x, this.footprintPoint.y, this.footprintPoint.z);
    }
    positions.needsUpdate = true;
    this.footprintLine.visible = true;
  }

  private updateObserverMarkerScale(): void {
    if (!this.observerMarker.visible) return;
    const scale = Math.max(1, this.camera.position.distanceTo(this.observerPosition) * 0.45);
    this.observerMarker.scale.setScalar(scale);
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

  private updateFollow(): void {
    if (this.focusTransition || !this.followEnabled || this.selectedIndex === null) return;
    const position = this.readSatellitePosition(this.selectedIndex, this.followTarget);
    if (!position) return;

    const targetRadius = Math.max(0, (position.length() - EARTH_RADIUS) / 2);
    position.normalize().multiplyScalar(targetRadius);
    this.followDelta.copy(position).sub(this.controls.target).multiplyScalar(0.09);
    this.controls.target.add(this.followDelta);
    this.camera.position.add(this.followDelta);
  }

  private readonly handleControlsStart = (): void => {
    this.focusTransition = undefined;
    if (this.followEnabled) {
      this.followEnabled = false;
      this.onFollowExited?.();
    }
  };

  private updateCategoryColors(): void {
    const cloud = this.satelliteCloud;
    if (!cloud) return;
    cloud.records.forEach((record, index) => {
      CATEGORY_COLORS[primarySatelliteCategory(record)].toArray(cloud.colors, index * 3);
    });
    (cloud.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private applySatelliteVisibility(): void {
    const cloud = this.satelliteCloud;
    if (!cloud) return;
    cloud.records.forEach((record, index) => {
      const categoryVisible = matchesSatelliteFilter(record, this.currentFilter);
      const observerVisible = !this.observerAboveOnly || cloud.aboveHorizon[index] === 1;
      cloud.visibility[index] = categoryVisible && observerVisible ? 1 : 0;
    });
    (cloud.geometry.getAttribute('visibility') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateAltitudeColors(): void {
    const cloud = this.satelliteCloud;
    if (!cloud) return;

    for (let index = 0; index < cloud.records.length; index += 1) {
      const offset = index * 3;
      const x = cloud.positions[offset];
      const y = cloud.positions[offset + 1];
      const z = cloud.positions[offset + 2];
      const altitudeKm = Number.isFinite(x)
        ? Math.max(0, (Math.hypot(x, y, z) - 1) * EARTH_EQUATORIAL_RADIUS_KM)
        : 0;
      writeAltitudeColor(cloud.colors, offset, altitudeKm);
    }
    (cloud.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private createReferenceOrbits(): void {
    for (const altitudeKm of REFERENCE_ALTITUDES_KM) {
      const radius = 1 + altitudeKm / EARTH_EQUATORIAL_RADIUS_KM;
      const points: THREE.Vector3[] = [];
      for (let index = 0; index < 192; index += 1) {
        const angle = (index / 192) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: altitudeKm === 35_786 ? 0x9c91c8 : 0x7aa7b8,
        opacity: altitudeKm === 35_786 ? 0.18 : 0.1,
        transparent: true,
        depthWrite: false,
      });
      const ring = new THREE.LineLoop(geometry, material);
      ring.name = `Reference orbit ${altitudeKm} km`;
      this.referenceOrbitGroup.add(ring);
    }
  }

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

  private clearGroundTrack(): void {
    if (this.groundTrackLine) {
      this.scene.remove(this.groundTrackLine);
      this.groundTrackLine.geometry.dispose();
      this.groundTrackLine.material.dispose();
      this.groundTrackLine = undefined;
    }
    this.setGroundContextVisible(false);
  }

  private setGroundContextVisible(visible: boolean): void {
    this.selectedSurfaceMarker.visible = visible && this.selectedMarker.visible;
    this.altitudeLine.visible = visible && this.selectedMarker.visible;
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
      this.earthMaterial.emissiveMap = texture;
      this.earthMaterial.emissive.setHex(0xffffff);
      this.earthMaterial.emissiveIntensity = 0.7;
      this.earthMaterial.color.setHex(0xffffff);
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

interface AltitudeColorStop {
  altitudeKm: number;
  color: readonly [number, number, number];
}

const ALTITUDE_COLOR_STOPS: readonly AltitudeColorStop[] = [
  { altitudeKm: 0, color: [0.36, 0.78, 0.92] as const },
  { altitudeKm: 2_000, color: [0.55, 0.78, 0.74] as const },
  { altitudeKm: 20_200, color: [0.79, 0.7, 0.48] as const },
  { altitudeKm: 40_000, color: [0.64, 0.5, 0.78] as const },
];

function writeAltitudeColor(target: Float32Array, offset: number, altitudeKm: number): void {
  let lower = ALTITUDE_COLOR_STOPS[0];
  let upper = ALTITUDE_COLOR_STOPS[ALTITUDE_COLOR_STOPS.length - 1];
  for (let index = 1; index < ALTITUDE_COLOR_STOPS.length; index += 1) {
    upper = ALTITUDE_COLOR_STOPS[index];
    if (altitudeKm <= upper.altitudeKm) break;
    lower = upper;
  }

  const range = upper.altitudeKm - lower.altitudeKm;
  const blend =
    range > 0 ? THREE.MathUtils.clamp((altitudeKm - lower.altitudeKm) / range, 0, 1) : 1;
  target[offset] = THREE.MathUtils.lerp(lower.color[0], upper.color[0], blend);
  target[offset + 1] = THREE.MathUtils.lerp(lower.color[1], upper.color[1], blend);
  target[offset + 2] = THREE.MathUtils.lerp(lower.color[2], upper.color[2], blend);
}
