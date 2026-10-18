import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  MeshBasicMaterial,
  PerspectiveCamera,
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
  camera.position.fromArray(globePosition(25, 80, 3.25));
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
  let groups: StationGroup[] = [],
    selected: StationPreview | null = null,
    previewId: string | null = null;
  let transition: { from: Vector3; to: Vector3; rotation: Quaternion; start: number } | undefined;
  const easingRotation = new Quaternion();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  controls.enableDamping = !reduced && !powerSave;
  const earth = new Group();
  scene.add(earth);
  scene.add(new AmbientLight(0x83aaa3, 1.3));
  const light = new DirectionalLight(0xe8e9e1, 2);
  light.position.set(3, 4, 5);
  scene.add(light);
  const body = new Mesh(
    geometry(new SphereGeometry(1, 80, 48)),
    material(new MeshStandardMaterial({ color: 0x0b1c23, roughness: 1, metalness: 0 })),
  );
  earth.add(body);
  const pointShader = (size: number, opacity: number) =>
    material(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexColors: true,
        uniforms: { pointSize: { value: size }, opacity: { value: opacity } },
        vertexShader:
          'uniform float pointSize; varying vec3 vColor; void main(){vColor=color; gl_PointSize=pointSize; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'uniform float opacity; varying vec3 vColor; void main(){float d=length(gl_PointCoord-0.5); if(d>0.5)discard; gl_FragColor=vec4(vColor,opacity*(1.0-smoothstep(0.25,0.5,d)));\n#include <colorspace_fragment>\n}',
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
    return new Points(buffer, pointShader(size, opacity));
  }
  const mainland = makePoints(land.points, 1.2, 0.55, 0x83aaa3);
  earth.add(mainland);
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
    material(new LineBasicMaterial({ color: 0x83aaa3, transparent: true, opacity: 0.2 })),
  );
  earth.add(coast);
  const rim = new Mesh(
    geometry(new SphereGeometry(1.014, 64, 40)),
    material(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader:
          'varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
        fragmentShader:
          'varying vec3 vNormal; varying vec3 vView; void main(){float edge=pow(1.0-abs(dot(normalize(vNormal),normalize(vView))),4.0);gl_FragColor=vec4(0.38,0.56,0.58,edge*0.3);\n#include <colorspace_fragment>\n}',
      }),
    ),
  );
  earth.add(rim);
  const markers = new Points(geometry(new BufferGeometry()), pointShader(3.6, 0.88));
  earth.add(markers);
  const selection = new Mesh(
    geometry(new RingGeometry(0.018, 0.023, 40)),
    material(new MeshBasicMaterial({ color: 0xd8ad6b, transparent: true, opacity: 0.9 })),
  );
  selection.visible = false;
  earth.add(selection);
  const ray = new Raycaster(),
    mouse = new Vector2(),
    projected = new Vector3();
  const cyan = new Color(0x83aaa3),
    amber = new Color(0xd8ad6b);
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
  function draw(now: number) {
    frame = 0;
    if (disposed || !active || lost || document.hidden) return;
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
    const moving = controls.update();
    renderer.render(scene, camera);
    if (moving || transition) invalidate();
  }
  function resize() {
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width;
    height = bounds.height;
    const ratio = powerSave ? 1 : Math.min(devicePixelRatio || 1, width < 768 ? 1.5 : 1.75);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    mainland.material.uniforms.pointSize!.value = 1.2 * ratio;
    markers.material.uniforms.pointSize!.value = 3.6 * ratio;
    camera.aspect = width / height;
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
    if (colors) {
      for (let index = 0; index < groups.length; index++)
        (groups[index]!.stations.some((station) => station.id === selected?.id)
          ? amber
          : cyan
        ).toArray(colors.array, index * 3);
      colors.needsUpdate = true;
    }
    selection.visible =
      selected?.locationPrecision === 'coordinates' &&
      selected.latitude !== null &&
      selected.longitude !== null;
    if (selection.visible && selected) {
      selection.position.fromArray(globePosition(selected.latitude!, selected.longitude!, 1.018));
      selection.lookAt(selection.position.clone().multiplyScalar(2));
    }
    invalidate();
  }
  function rebuildMarkers() {
    allowDwell = false;
    dwell.cancel();
    groups = [];
    const coordinates: number[] = [];
    for (const group of sourceGroups) {
      const center = new Vector3().fromArray(globePosition(group.latitude, group.longitude, 1.012));
      if (group.id === expandedId && group.stations.length > 1) {
        const normal = center.clone().normalize();
        const east = new Vector3().crossVectors(new Vector3(0, 1, 0), normal);
        if (east.lengthSq() < 0.001) east.set(1, 0, 0);
        east.normalize();
        const north = new Vector3().crossVectors(normal, east).normalize();
        for (const [index, station] of group.stations.slice(0, 48).entries()) {
          const angle = index * 2.3999632297,
            radius = 0.012 * Math.sqrt(index + 1);
          const point = center
            .clone()
            .addScaledVector(east, Math.cos(angle) * radius)
            .addScaledVector(north, Math.sin(angle) * radius)
            .normalize()
            .multiplyScalar(1.014);
          coordinates.push(...point.toArray());
          groups.push({ ...group, id: group.id + ':' + station.id, stations: [station] });
        }
      } else {
        coordinates.push(...center.toArray());
        groups.push(group);
      }
    }
    const old = markers.geometry;
    geometries.delete(old);
    old.dispose();
    const buffer = geometry(new BufferGeometry());
    positions = new Float32Array(coordinates);
    buffer.setAttribute('position', new BufferAttribute(positions, 3));
    buffer.setAttribute('color', new BufferAttribute(new Float32Array(groups.length * 3), 3));
    markers.geometry = buffer;
    markers.visible = groups.length > 0;
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
        moveTo(new Vector3().fromArray(globePosition(group.latitude, group.longitude, 1.65)));
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
      resize();
    },
    setSelection(station) {
      if (selected?.id !== station?.id) {
        allowDwell = false;
        dwell.cancel();
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
      moveTo(new Vector3().fromArray(globePosition(25, 80, 3.25)));
    },
    focus(station) {
      if (
        station.locationPrecision !== 'coordinates' ||
        station.latitude === null ||
        station.longitude === null
      )
        return false;
      moveTo(new Vector3().fromArray(globePosition(station.latitude, station.longitude, 2.55)));
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
      .find(
        (value) =>
          value.distance <= surface + 0.04 &&
          value.index !== undefined &&
          projected.fromArray(positions, value.index * 3).dot(camera.position) > 1.02,
      );
    const group = hit?.index === undefined ? undefined : groups[hit.index];
    if (group) {
      showPreview(group);
      callbacks.pick(group, 'click');
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
