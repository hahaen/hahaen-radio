import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Raycaster,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StationPreview } from '@haen/contracts';
import type { LandData } from './land';
import { DwellSelection, globePosition, type StationGroup } from './model';
import { stationMarkers, stationPosition, type StationMarker } from './markers';
import { markerCrowding } from './marker-appearance';
export type PickReason = 'click' | 'dwell';
export interface GlobeController {
  cancelSelection(): void;
  setData(groups: StationGroup[]): void;
  setSelection(station: StationPreview | null): void;
  setPinned(pinned: boolean): void;
  setActive(active: boolean): void;
  setPowerSave(value: boolean): void;
  setExpanded(id: string | null): void;
  zoom(factor: number): void;
  reset(): void;
  focus(station: StationPreview): boolean;
  destroy(): void;
}
export function createGlobe(
  container: HTMLElement,
  land: LandData,
  callbacks: {
    label: string;
    pick(group: StationGroup, reason: PickReason): void;
    preview(group: StationGroup | null): void;
    lost(): void;
    restored(): void;
  },
): GlobeController {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', callbacks.label);
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  const scene = new Scene(),
    camera = new PerspectiveCamera(38, 1, 0.05, 20);
  camera.position.fromArray(globePosition(25, 80, 3.8));
  camera.lookAt(0, 0, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minDistance = 1.22;
  controls.maxDistance = 5.5;
  controls.dampingFactor = 0.09;
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>();
  const geometry = <T extends BufferGeometry>(value: T) => {
    geometries.add(value);
    return value;
  };
  const material = <T extends Material>(value: T) => {
    materials.add(value);
    return value;
  };
  const listeners: (() => void)[] = [];
  const dwell = new DwellSelection();
  let pendingGroup: string | null = null;
  let frame = 0,
    disposed = false,
    active = true,
    lost = false,
    pinned = false,
    dragging = false,
    allowDwell = false;
  let positions = new Float32Array();
  let sourceGroups: StationGroup[] = [];
  let expandedId: string | null = null,
    powerSave = false;
  let groups: StationMarker[] = [],
    selected: StationPreview | null = null,
    previewId: string | null = null;
  const markerIndices = new Map<string, number>();
  let transition: { from: Vector3; to: Vector3; rotation: Quaternion; start: number } | undefined;
  const easingRotation = new Quaternion();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  controls.enableDamping = !reduced && !powerSave;
  const earth = new Group();
  scene.add(earth);
  const body = new Mesh(
    geometry(new SphereGeometry(1, 80, 48)),
    material(
      new ShaderMaterial({
        uniforms: {
          ocean: { value: new Color(0x153a2d) },
          shadow: { value: new Color(0x050f0c) },
          atmosphere: { value: new Color(0x79b99a) },
        },
        vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-p.xyz);
          gl_Position = projectionMatrix * p;
        }`,
        fragmentShader: `
        uniform vec3 ocean; uniform vec3 shadow; uniform vec3 atmosphere;
        varying vec3 vNormal; varying vec3 vView;
        void main() {
          vec3 n = normalize(vNormal);
          float light = smoothstep(-0.3, 0.9, dot(n, normalize(vec3(-0.75, 0.65, 0.7))));
          float edge = pow(1.0 - max(0.0, dot(n, normalize(vView))), 3.5);
          vec3 color = mix(shadow, ocean, light);
          color += atmosphere * edge * light * 0.08;
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
      }),
    ),
  );
  earth.add(body);
  const pointShader = (size: number, opacity: number, glow = false) =>
    material(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        uniforms: {
          pointSize: { value: size },
          opacity: { value: opacity },
          time: { value: 0 },
          glow: { value: glow ? 1 : 0 },
          zoom: { value: 1 },
        },
        vertexShader: `
          uniform float pointSize; uniform float time; uniform float glow; uniform float zoom;
          attribute float approximate; attribute float crowding; attribute float emphasis;
          varying float vApproximate; varying vec3 vColor; varying float vPulse; varying float vFacing;
          varying float vDensity; varying float vEmphasis; varying float vSeed; varying float vLight;
          void main() {
            vApproximate=approximate; vColor=color; vEmphasis=emphasis;
            vec4 viewPosition=modelViewMatrix*vec4(position,1.0);
            vec3 viewNormal=normalize(normalMatrix*normalize(position));
            vFacing=max(0.0,dot(viewNormal,normalize(-viewPosition.xyz)));
            vLight=smoothstep(-0.3,0.9,dot(viewNormal,normalize(vec3(-0.75,0.65,0.7))));
            vSeed=fract(sin(dot(position,vec3(12.9898,78.233,37.719)))*43758.5453);
            vPulse=0.65+0.35*sin(time*(0.65+vSeed*0.6)+vSeed*62.8);
            vDensity=sqrt(clamp(crowding/(zoom*zoom),0.0,1.0))*(1.0-emphasis);
            gl_PointSize=pointSize*mix(1.0,0.72,approximate)*mix(1.0,0.45,vDensity)
              *(1.0+glow*vPulse*0.10+emphasis*0.35);
            gl_Position=projectionMatrix*viewPosition;
          }`,
        fragmentShader: `
          uniform float opacity; uniform float glow;
          varying float vApproximate; varying vec3 vColor; varying float vPulse; varying float vFacing;
          varying float vDensity; varying float vEmphasis; varying float vSeed; varying float vLight;
          void main() {
            float d=length(gl_PointCoord-0.5); if(d>0.5)discard;
            float dotAlpha=1.0-smoothstep(0.32,0.5,d);
            float core=1.0-smoothstep(0.06,0.26,d);
            float halo=exp(-d*d*28.0)*(0.16+0.06*vPulse);
            float hollow=smoothstep(0.10,0.20,d)*(1.0-smoothstep(0.32,0.48,d));
            float stationAlpha=mix(min(1.0,core+halo),hollow,vApproximate);
            float precisionAlpha=mix(1.0,0.44,vApproximate);
            float densityAlpha=mix(1.0,0.18,vDensity);
            float facing=mix(0.20,1.0,smoothstep(0.0,0.65,vFacing));
            float alpha=opacity*facing*mix(dotAlpha,stationAlpha*precisionAlpha*densityAlpha*(0.76+vSeed*0.24),glow);
            vec3 tint=mix(vColor,vec3(1.0,0.92,0.77),vEmphasis*core*0.68);
            tint*=mix(0.58+0.42*vLight,1.0,glow);
            gl_FragColor=vec4(tint,alpha);
            #include <colorspace_fragment>
          }`,
      }),
    );
  function makePoints(
    coordinates: readonly (readonly number[])[],
    size: number,
    opacity: number,
    color: number,
  ) {
    const buffer = geometry(new BufferGeometry());
    buffer.setAttribute(
      'position',
      new Float32BufferAttribute(
        coordinates.flatMap((point) => globePosition(point[1]!, point[0]!, 1.004)),
        3,
      ),
    );
    const colors = new Float32Array(coordinates.length * 3),
      rgb = new Color(color);
    for (let index = 0; index < coordinates.length; index++) rgb.toArray(colors, index * 3);
    buffer.setAttribute('color', new BufferAttribute(colors, 3));
    buffer.setAttribute(
      'approximate',
      new BufferAttribute(new Float32Array(coordinates.length), 1),
    );
    buffer.setAttribute('crowding', new BufferAttribute(new Float32Array(coordinates.length), 1));
    buffer.setAttribute('emphasis', new BufferAttribute(new Float32Array(coordinates.length), 1));
    return new Points(buffer, pointShader(size, opacity));
  }
  const mainland = makePoints(land.points, 1.5, 0.58, 0xd4ead9);
  const oceanCoordinates: number[][] = [];
  for (let latitude = -88; latitude <= 88; latitude += 1.8) {
    const count = Math.max(3, Math.round(200 * Math.cos((latitude * Math.PI) / 180)));
    for (let index = 0; index < count; index++)
      oceanCoordinates.push([(index * 360) / count - 180, latitude]);
  }
  const oceanDots = makePoints(oceanCoordinates, 1.5, 0.025, 0x7cae99);
  earth.add(oceanDots);
  earth.add(mainland);
  const grid: number[] = [];
  const segment = (latA: number, lonA: number, latB: number, lonB: number) => {
    grid.push(...globePosition(latA, lonA, 1.002), ...globePosition(latB, lonB, 1.002));
  };
  for (let latitude = -60; latitude <= 60; latitude += 30)
    for (let longitude = -180; longitude < 180; longitude += 2)
      segment(latitude, longitude, latitude, longitude + 2);
  for (let longitude = -180; longitude < 180; longitude += 30)
    for (let latitude = -90; latitude < 90; latitude += 2)
      segment(latitude, longitude, latitude + 2, longitude);
  const graticule = new LineSegments(
    geometry(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(grid, 3))),
    material(
      new LineBasicMaterial({
        color: 0x92baa5,
        transparent: true,
        opacity: 0.065,
        depthWrite: false,
      }),
    ),
  );
  earth.add(graticule);
  const outline: number[] = [];
  for (const polygon of land.polygons)
    for (const ring of polygon)
      for (let index = 1; index < ring.length; index++) {
        const a = ring[index - 1]!,
          b = ring[index]!;
        const delta = ((((b[0] - a[0] + 540) % 360) + 360) % 360) - 180;
        const count = Math.max(1, Math.ceil(Math.max(Math.abs(delta), Math.abs(b[1] - a[1])) / 2));
        for (let step = 0; step < count; step++)
          for (const t of [step / count, (step + 1) / count])
            outline.push(...globePosition(a[1] + (b[1] - a[1]) * t, a[0] + delta * t, 1.003));
      }
  const coast = new LineSegments(
    geometry(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(outline, 3))),
    material(new LineBasicMaterial({ color: 0xb3d8c0, transparent: true, opacity: 0.16 })),
  );
  earth.add(coast);
  const rim = new Mesh(
    geometry(new SphereGeometry(1.024, 64, 40)),
    material(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader:
          'varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
        fragmentShader: `varying vec3 vNormal; varying vec3 vView;
          void main(){
            vec3 n=normalize(vNormal);
            float edge=pow(1.0-abs(dot(n,normalize(vView))),6.0);
            float light=smoothstep(-0.35,0.8,dot(n,normalize(vec3(-0.75,0.65,0.7))));
            gl_FragColor=vec4(0.42,0.68,0.53,edge*(0.035+light*0.18));
            #include <colorspace_fragment>
          }`,
      }),
    ),
  );
  earth.add(rim);
  const markers = new Points(geometry(new BufferGeometry()), pointShader(5.2, 0.94, true));
  earth.add(markers);
  const selection = new Mesh(
    geometry(new RingGeometry(0.03, 0.034, 64)),
    material(new MeshBasicMaterial({ color: 0xf36b45, transparent: true, opacity: 0.9 })),
  );
  const selectionGlow = new Mesh(
    geometry(new PlaneGeometry(0.16, 0.16)),
    material(
      new ShaderMaterial({
        uniforms: { tint: { value: new Color(0xf36b45) } },
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform vec3 tint; varying vec2 vUv;
        void main(){float r=length(vUv-0.5)*2.0;
          float alpha=exp(-r*r*6.0)*0.22*(1.0-smoothstep(0.65,1.0,r));
          gl_FragColor=vec4(tint,alpha);
          #include <colorspace_fragment>
        }`,
      }),
    ),
  );
  selection.add(selectionGlow);
  selection.visible = false;
  earth.add(selection);
  const ray = new Raycaster(),
    mouse = new Vector2(),
    projected = new Vector3();
  const cyan = new Color(0xf5f1e8),
    amber = new Color(0xf36b45);
  const startPointers = new Map<number, { x: number; y: number; moved: boolean }>();
  let width = 1,
    height = 1;
  function listen(
    target: EventTarget,
    name: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(name, listener, options);
    listeners.push(() => target.removeEventListener(name, listener, options));
  }
  function invalidate() {
    if (!frame && active && !lost && !disposed && !document.hidden)
      frame = requestAnimationFrame(draw);
  }
  function showPreview(group: StationGroup | null) {
    if (previewId === (group?.id ?? null)) return;
    previewId = group?.id ?? null;
    callbacks.preview(group);
  }
  function centerGroup(): StationGroup | null {
    let closest: StationGroup | null = null,
      distance = 48 * 48;
    camera.updateMatrixWorld();
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index]!;
      projected.fromArray(positions, index * 3);
      if (projected.dot(camera.position) <= 1.02) continue;
      projected.project(camera);
      if (projected.z > 1 || projected.z < -1) continue;
      const d = ((projected.x * width) / 2) ** 2 + ((projected.y * height) / 2) ** 2;
      if (d < distance) {
        distance = d;
        closest = group;
      }
    }
    return closest;
  }
  function armDwell() {
    const group = centerGroup();
    showPreview(group);
    if (!group || !allowDwell || pinned || dragging || !active || lost || document.hidden) {
      dwell.cancel();
      pendingGroup = null;
      return;
    }
    // Selection stability concerns the point under the reticle, not microscopic camera damping.
    if (dwell.pending && pendingGroup === group.id) return;
    pendingGroup = group.id;
    dwell.schedule(() => {
      if (disposed || !active || lost || pinned || dragging || document.hidden || !allowDwell)
        return;
      if (centerGroup()?.id !== group.id) {
        armDwell();
        return;
      }
      allowDwell = false;
      callbacks.pick(group, 'dwell');
    });
  }
  function changed() {
    invalidate();
    armDwell();
  }
  const started = () => {
    dragging = true;
    allowDwell = true;
    transition = undefined;
    dwell.cancel();
  };
  const ended = () => {
    dragging = false;
    armDwell();
  };
  controls.addEventListener('change', changed);
  controls.addEventListener('start', started);
  controls.addEventListener('end', ended);
  let lastPaint = 0;
  function draw(now: number) {
    frame = 0;
    if (disposed || !active || lost || document.hidden) return;
    if (!reduced && !powerSave && now - lastPaint < 32) {
      invalidate();
      return;
    }
    lastPaint = now;
    if (transition) {
      const t = Math.min(1, (now - transition.start) / 500),
        eased = 1 - (1 - t) ** 3;
      easingRotation.identity().slerp(transition.rotation, eased);
      const fromRadius = transition.from.length(),
        toRadius = transition.to.length();
      camera.position
        .copy(transition.from)
        .normalize()
        .applyQuaternion(easingRotation)
        .multiplyScalar(fromRadius + (toRadius - fromRadius) * eased);
      camera.lookAt(0, 0, 0);
      if (t === 1) transition = undefined;
    }
    markers.material.uniforms.time!.value = reduced || powerSave ? 0 : now / 1000;
    const moving = controls.update();
    updateMarkerSize();
    renderer.render(scene, camera);
    if (moving || transition || (!reduced && !powerSave && groups.length > 0)) invalidate();
  }
  function updateMarkerSize() {
    const zoom = Math.min(1.7, 3.8 / camera.position.length());
    const size = 5.2 * Math.min(1, Math.min(width, height) / 600) * zoom;
    markers.material.uniforms.zoom!.value = zoom;
    markers.material.uniforms.pointSize!.value = Math.max(1.8, size) * renderer.getPixelRatio();
  }
  function resize() {
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width;
    height = bounds.height;
    const ratio = powerSave ? 1 : Math.min(devicePixelRatio || 1, width < 768 ? 1.5 : 1.75);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    mainland.material.uniforms.pointSize!.value = ratio * 1.5;
    oceanDots.material.uniforms.pointSize!.value = ratio * 1.5;
    updateMarkerSize();
    camera.aspect = width / height;
    camera.fov =
      camera.aspect < 1
        ? (Math.atan(Math.tan((19 * Math.PI) / 180) / camera.aspect) * 360) / Math.PI
        : 38;
    camera.updateProjectionMatrix();
    invalidate();
  }
  function moveTo(position: Vector3) {
    allowDwell = false;
    dwell.cancel();
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = !reduced && !powerSave;
    if (reduced || powerSave) {
      transition = undefined;
      camera.position.copy(position);
      controls.update();
    } else
      transition = {
        from: camera.position.clone(),
        to: position,
        rotation: new Quaternion().setFromUnitVectors(
          camera.position.clone().normalize(),
          position.clone().normalize(),
        ),
        start: performance.now(),
      };
    invalidate();
  }
  function updateSelection() {
    const colors = markers.geometry.getAttribute('color');
    const emphasis = markers.geometry.getAttribute('emphasis');
    if (colors) {
      for (let index = 0; index < groups.length; index++)
        (groups[index]!.stations.some((station) => station.id === selected?.id)
          ? amber
          : cyan
        ).toArray(colors.array, index * 3);
      colors.needsUpdate = true;
      if (emphasis) {
        for (let index = 0; index < groups.length; index++)
          emphasis.setX(
            index,
            groups[index]!.stations.some((station) => station.id === selected?.id) ? 1 : 0,
          );
        emphasis.needsUpdate = true;
      }
    }
    const position = selected ? stationPosition(selected) : null;
    selection.visible = position !== null;
    if (position) {
      const index = selected ? markerIndices.get(selected.id) : undefined;
      if (index !== undefined)
        selection.position
          .fromArray(positions, index * 3)
          .normalize()
          .multiplyScalar(1.018);
      else
        selection.position.fromArray(globePosition(position.latitude, position.longitude, 1.018));
      selection.scale.setScalar(position.precision === 'country' ? 1.4 : 1);
      selection.lookAt(selection.position.clone().multiplyScalar(2));
    }
    invalidate();
  }
  function rebuildMarkers() {
    allowDwell = false;
    dwell.cancel();
    groups = stationMarkers(sourceGroups);
    markerIndices.clear();
    const coordinates: number[] = [];
    for (const [index, marker] of groups.entries()) {
      markerIndices.set(marker.stations[0]!.id, index);
      const center = new Vector3().fromArray(
        globePosition(marker.latitude, marker.longitude, 1.012),
      );
      if (
        marker.precision === 'coordinates' &&
        marker.groupId === expandedId &&
        marker.memberCount > 1
      ) {
        const normal = center.clone().normalize();
        const east = new Vector3().crossVectors(new Vector3(0, 1, 0), normal);
        if (east.lengthSq() < 0.001) east.set(1, 0, 0);
        east.normalize();
        const north = new Vector3().crossVectors(normal, east).normalize();
        const angle = marker.memberIndex * 2.3999632297,
          radius =
            0.012 * Math.sqrt((marker.memberIndex + 1) * Math.min(1, 48 / marker.memberCount));
        const point = center
          .clone()
          .addScaledVector(east, Math.cos(angle) * radius)
          .addScaledVector(north, Math.sin(angle) * radius)
          .normalize()
          .multiplyScalar(1.014);
        coordinates.push(...point.toArray());
      } else {
        coordinates.push(...center.toArray());
      }
    }
    const old = markers.geometry;
    geometries.delete(old);
    old.dispose();
    const buffer = geometry(new BufferGeometry());
    positions = new Float32Array(coordinates);
    buffer.setAttribute('position', new BufferAttribute(positions, 3));
    buffer.setAttribute('color', new BufferAttribute(new Float32Array(groups.length * 3), 3));
    buffer.setAttribute('crowding', new BufferAttribute(markerCrowding(positions), 1));
    buffer.setAttribute('emphasis', new BufferAttribute(new Float32Array(groups.length), 1));
    buffer.setAttribute(
      'approximate',
      new Float32BufferAttribute(
        groups.map((group) => (group.precision === 'country' ? 1 : 0)),
        1,
      ),
    );
    markers.geometry = buffer;
    markers.visible = groups.length > 0;
    canvas.dataset.markerCount = String(groups.length);
    updateSelection();
    showPreview(null);
  }
  const api: GlobeController = {
    cancelSelection() {
      allowDwell = false;
      dwell.cancel();
    },
    setData(value) {
      sourceGroups = value;
      rebuildMarkers();
    },
    setExpanded(id) {
      if (expandedId === id) return;
      expandedId = id;
      rebuildMarkers();
      const group = sourceGroups.find((value) => value.id === id);
      if (group)
        moveTo(
          new Vector3().fromArray(
            globePosition(
              group.latitude,
              group.longitude,
              group.precision === 'country' ? 2.8 : 1.65,
            ),
          ),
        );
    },
    setPowerSave(value) {
      powerSave = value;
      controls.enableDamping = !reduced && !powerSave;
      mainland.geometry.setIndex(
        powerSave
          ? Array.from({ length: Math.ceil(land.points.length / 2) }, (_, index) => index * 2)
          : null,
      );
      if (powerSave && transition) {
        camera.position.copy(transition.to);
        transition = undefined;
        controls.update();
      }
      oceanDots.visible = !powerSave;
      graticule.visible = !powerSave;
      resize();
    },
    setSelection(station) {
      if (selected?.id !== station?.id) {
        allowDwell = false;
        transition = undefined;
        dwell.cancel();
        showPreview(null);
      }
      selected = station;
      updateSelection();
    },
    setPinned(value) {
      pinned = value;
      allowDwell = false;
      dwell.cancel();
    },
    setActive(value) {
      active = value;
      controls.enabled = value;
      if (!value) {
        allowDwell = false;
        dwell.cancel();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else {
        resize();
        invalidate();
      }
    },
    zoom(factor) {
      transition = undefined;
      allowDwell = true;
      camera.position.setLength(
        Math.max(
          controls.minDistance,
          Math.min(controls.maxDistance, camera.position.length() * factor),
        ),
      );
      controls.update();
      armDwell();
      invalidate();
    },
    reset() {
      showPreview(null);
      moveTo(new Vector3().fromArray(globePosition(25, 80, 3.8)));
    },
    focus(station) {
      const position = stationPosition(station);
      if (!position) return false;
      showPreview(null);
      const index = markerIndices.get(station.id);
      const radius = position.precision === 'country' ? 2.35 : 1.95;
      moveTo(
        index === undefined
          ? new Vector3().fromArray(globePosition(position.latitude, position.longitude, radius))
          : new Vector3()
              .fromArray(positions, index * 3)
              .normalize()
              .multiplyScalar(radius),
      );
      return true;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      dwell.cancel();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      for (const remove of listeners) remove();
      controls.removeEventListener('change', changed);
      controls.removeEventListener('start', started);
      controls.removeEventListener('end', ended);
      controls.dispose();
      for (const value of geometries) value.dispose();
      for (const value of materials) value.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      groups = [];
      sourceGroups = [];
      markerIndices.clear();
      selected = null;
    },
  };
  listen(canvas, 'pointerdown', (event) => {
    const e = event as PointerEvent;
    startPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
    if (startPointers.size > 1) for (const value of startPointers.values()) value.moved = true;
  });
  listen(canvas, 'pointermove', (event) => {
    const e = event as PointerEvent,
      start = startPointers.get(e.pointerId);
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) start.moved = true;
  });
  listen(canvas, 'pointercancel', () => {
    startPointers.clear();
    allowDwell = false;
    dragging = false;
    dwell.cancel();
  });
  listen(canvas, 'pointerup', (event) => {
    const e = event as PointerEvent,
      start = startPointers.get(e.pointerId);
    startPointers.delete(e.pointerId);
    if (!start || start.moved || startPointers.size || disposed || lost) return;
    allowDwell = false;
    dwell.cancel();
    const bounds = canvas.getBoundingClientRect();
    mouse.set(
      ((e.clientX - bounds.left) / width) * 2 - 1,
      (-(e.clientY - bounds.top) / height) * 2 + 1,
    );
    ray.params.Points!.threshold =
      ((2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.length()) / height) * 14;
    camera.updateMatrixWorld();
    ray.setFromCamera(mouse, camera);
    const surface = ray.intersectObject(body, false)[0]?.distance ?? Infinity;
    const hit = ray
      .intersectObject(markers, false)
      .sort((a, b) => (a.distanceToRay ?? Infinity) - (b.distanceToRay ?? Infinity))
      .find(
        (value) =>
          value.distance <= surface + 0.04 &&
          value.index !== undefined &&
          projected.fromArray(positions, value.index * 3).dot(camera.position) > 1.02,
      );
    const group = hit?.index === undefined ? undefined : groups[hit.index];
    if (group) {
      showPreview(group);
      callbacks.pick(sourceGroups.find((source) => source.id === group.groupId) ?? group, 'click');
    }
  });
  listen(canvas, 'keydown', (event) => {
    const e = event as KeyboardEvent;
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    const spherical = new Spherical().setFromVector3(camera.position);
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft':
        spherical.theta -= 0.15;
        break;
      case 'ArrowRight':
        spherical.theta += 0.15;
        break;
      case 'ArrowUp':
        spherical.phi = Math.max(0.08, spherical.phi - 0.12);
        break;
      case 'ArrowDown':
        spherical.phi = Math.min(Math.PI - 0.08, spherical.phi + 0.12);
        break;
      case '+':
      case '=':
        api.zoom(0.82);
        break;
      case '-':
        api.zoom(1.22);
        break;
      case 'Home':
        api.reset();
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key.startsWith('Arrow')) {
      transition = undefined;
      allowDwell = true;
      camera.position.setFromSpherical(spherical);
      controls.update();
      armDwell();
      invalidate();
    }
  });
  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    allowDwell = false;
    dwell.cancel();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    callbacks.lost();
  });
  listen(canvas, 'webglcontextrestored', () => {
    if (!disposed) callbacks.restored();
  });
  listen(document, 'visibilitychange', () => {
    allowDwell = false;
    dwell.cancel();
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  });
  listen(motion, 'change', () => {
    reduced = motion.matches;
    controls.enableDamping = !reduced && !powerSave;
    if (reduced && transition) {
      camera.position.copy(transition.to);
      transition = undefined;
      controls.update();
    }
    invalidate();
  });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  container.append(canvas);
  resize();
  invalidate();
  return api;
}
