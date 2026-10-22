import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CircleGeometry,
  DataTexture,
  LinearFilter,
  RedFormat,
  RepeatWrapping,
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
import type { LandData } from './land.js';
import { DwellSelection, globePosition, type StationGroup } from './model.js';
import { stationMarkers, stationPosition, type StationMarker } from './markers.js';
import { markerCrowding } from './marker-appearance.js';
import { rasterizeLand, LAND_MASK_WIDTH, LAND_MASK_HEIGHT } from './land-mask.js';
export type PickReason = 'click' | 'dwell';
export interface GlobeController {
  cancelSelection(): void;
  setData(groups: StationGroup[]): void;
  setSelection(station: StationPreview | null): void;
  setPinned(pinned: boolean): void;
  setPlaying(playing: boolean): void;
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
    interact?(): void;
    label: string;
    selectionLabel?: HTMLElement | null;
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
    playing = false,
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
  let selectedIsPrecise = false;
  let transition: { from: Vector3; to: Vector3; rotation: Quaternion; start: number } | undefined;
  const easingRotation = new Quaternion();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  controls.enableDamping = !reduced && !powerSave;
  const earth = new Group();
  scene.add(earth);
  const landMask = new DataTexture(
    rasterizeLand(land.polygons),
    LAND_MASK_WIDTH,
    LAND_MASK_HEIGHT,
    RedFormat,
  );
  landMask.minFilter = LinearFilter;
  landMask.magFilter = LinearFilter;
  landMask.wrapS = RepeatWrapping;
  landMask.needsUpdate = true;
  const body = new Mesh(
    geometry(new SphereGeometry(1, 80, 48)),
    material(
      new ShaderMaterial({
        uniforms: {
          ocean: { value: new Color(0x091b18) },
          shadow: { value: new Color(0x020807) },
          atmosphere: { value: new Color(0x8abfb4) },
          continental: { value: new Color(0x244337) },
          landMask: { value: landMask },
        },
        vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vLocal = normalize(position);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-p.xyz);
          gl_Position = projectionMatrix * p;
        }`,
        fragmentShader: `
        uniform vec3 ocean; uniform vec3 shadow; uniform vec3 atmosphere; uniform vec3 continental;
        uniform sampler2D landMask;
        varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
        void main() {
          vec3 n = normalize(vNormal);
          float sun = dot(n, normalize(vec3(-0.9, 0.55, 0.55)));
          float light = smoothstep(-0.18, 0.95, sun);
          vec3 local = normalize(vLocal);
          vec2 uv = vec2(atan(local.x, local.z) / 6.2831853 + 0.5, 0.5 - asin(clamp(local.y, -1.0, 1.0)) / 3.14159265);
          float land = texture2D(landMask, uv).r;
          float edge = pow(1.0 - max(0.0, dot(n, normalize(vView))), 5.0);
          vec3 sea = mix(shadow, ocean, 0.16 + light * 0.84);
          vec3 ground = mix(shadow * 1.2, continental, 0.08 + light * 0.92);
          vec3 color = mix(sea, ground, land);
          float sheen = pow(max(0.0, dot(reflect(-normalize(vec3(-0.9, 0.55, 0.55)), n), normalize(vView))), 32.0);
          color += atmosphere * sheen * (1.0 - land) * 0.025;
          color += atmosphere * edge * light * 0.11;
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
        // Surface-anchored sprites must not intersect the globe at their screen-space edges.
        depthTest: !glow,
        vertexColors: true,
        uniforms: {
          pointSize: { value: size },
          opacity: { value: opacity },
          time: { value: 0 },
          playing: { value: 0 },
          glow: { value: glow ? 1 : 0 },
          zoom: { value: 1 },
        },
        vertexShader: `
          uniform float pointSize; uniform float time; uniform float glow; uniform float zoom; uniform float playing;
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
            vPulse=mix(0.5,0.5+0.5*sin(time*(1.1+vSeed*0.5)+vSeed*62.8),playing);
            vDensity=sqrt(clamp(crowding/(zoom*zoom),0.0,1.0))*(1.0-emphasis);
            // Regional anchors remain quiet, stable rings; precise locations carry the light.
            float stationSize=mix(0.88+vSeed*0.24,0.78,approximate);
            gl_PointSize=pointSize*mix(1.0,stationSize,glow)*mix(1.0,mix(0.60,0.90,approximate),vDensity)
              *(1.0+glow*(1.0-approximate)*playing*vPulse*0.06+emphasis*0.28);
            gl_Position=projectionMatrix*viewPosition;
          }`,
        fragmentShader: `
          uniform float opacity; uniform float glow; uniform float playing;
          varying float vApproximate; varying vec3 vColor; varying float vPulse; varying float vFacing;
          varying float vDensity; varying float vEmphasis; varying float vSeed; varying float vLight;
          void main() {
            if(glow>0.5 && vFacing<=0.0)discard;
            float d=length(gl_PointCoord-0.5);
            float aa=max(fwidth(d)*0.65,0.015);
            if(d>0.5)discard;
            float dotAlpha=1.0-smoothstep(0.32,0.5,d);
            if(glow<0.5){
              float surfaceCore=1.0-smoothstep(0.08,0.24,d);
              float surfaceFacing=mix(0.20,1.0,smoothstep(0.0,0.65,vFacing));
              vec3 surfaceTint=mix(vColor,vec3(1.0,0.94,0.83),surfaceCore*0.38);
              gl_FragColor=vec4(surfaceTint*(0.58+0.42*vLight),opacity*surfaceFacing*dotAlpha);
              #include <colorspace_fragment>
              return;
            }
            float core=1.0-smoothstep(0.10-aa,0.16+aa,d);
            float halo=exp(-d*d*22.0)*0.22*(1.0-vDensity*0.70);
            float light=(core+halo)*(1.0-smoothstep(0.36,0.5,d));
            float hollow=(1.0-smoothstep(0.035,0.035+aa,abs(d-0.29)))
              *smoothstep(0.12,0.20,d);
            float stationAlpha=mix(min(1.0,light),hollow,vApproximate);
            float precisionAlpha=mix(1.0,0.56+vEmphasis*0.24,vApproximate);
            float densityAlpha=mix(1.0,mix(0.32,0.60,vApproximate),vDensity);
            float facing=mix(0.12,1.0,smoothstep(0.0,0.55,vFacing));
            float alpha=opacity*facing*stationAlpha*precisionAlpha*densityAlpha*(0.78+vSeed*0.22);
            alpha*=mix(1.0,0.80+0.20*vPulse,playing*(1.0-vApproximate));
            vec3 tint=mix(vColor,vec3(1.0,0.94,0.83),core*(0.25+vEmphasis*0.30)*(1.0-vApproximate));
            tint=mix(tint,vec3(0.40,0.53,0.46),vApproximate*(1.0-vEmphasis)*0.45);
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
  const mainland = makePoints(land.points, 1.2, 0.018, 0xc0d4c8);
  const oceanCoordinates: number[][] = [];
  for (let latitude = -88; latitude <= 88; latitude += 1.8) {
    const count = Math.max(3, Math.round(200 * Math.cos((latitude * Math.PI) / 180)));
    for (let index = 0; index < count; index++)
      oceanCoordinates.push([(index * 360) / count - 180, latitude]);
  }
  const oceanDots = makePoints(oceanCoordinates, 1.2, 0.006, 0x7cae99);
  earth.add(oceanDots);
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
    material(new LineBasicMaterial({ color: 0xb3d8c0, transparent: true, opacity: 0.085 })),
  );
  earth.add(coast);
  const rim = new Mesh(
    geometry(new SphereGeometry(1.015, 64, 40)),
    material(
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader:
          'varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}',
        uniforms: { intensity: { value: 1 } },
        fragmentShader: `uniform float intensity; varying vec3 vNormal; varying vec3 vView;
          void main(){
            vec3 n=normalize(vNormal);
            float edge=pow(1.0-abs(dot(n,normalize(vView))),5.0);
            float light=smoothstep(-0.35,0.8,dot(n,normalize(vec3(-0.9,0.55,0.55))));
            gl_FragColor=vec4(0.43,0.67,0.60,edge*(0.012+light*0.18)*intensity);
            #include <colorspace_fragment>
          }`,
      }),
    ),
  );
  earth.add(rim);
  const markers = new Points(geometry(new BufferGeometry()), pointShader(8.0, 0.94, true));
  earth.add(markers);
  const selection = new Group();
  const selectionRing = new Mesh(
    geometry(new RingGeometry(0.035, 0.0365, 96)),
    material(
      new MeshBasicMaterial({
        color: 0xf5f1e8,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
      }),
    ),
  );
  const tickVertices: number[] = [];
  for (let index = 0; index < 48; index++) {
    const angle = (index * Math.PI) / 24;
    const outer = index % 4 === 0 ? 0.052 : 0.048;
    tickVertices.push(
      Math.cos(angle) * 0.043,
      Math.sin(angle) * 0.043,
      0,
      Math.cos(angle) * outer,
      Math.sin(angle) * outer,
      0,
    );
  }
  const selectionTicks = new LineSegments(
    geometry(
      new BufferGeometry().setAttribute('position', new Float32BufferAttribute(tickVertices, 3)),
    ),
    material(
      new LineBasicMaterial({
        color: 0xf5f1e8,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        depthTest: false,
      }),
    ),
  );
  const selectedLight = material(
    new ShaderMaterial({
      uniforms: {
        warm: { value: new Color(0xfff2ce) },
        amber: { value: new Color(0xf36b45) },
        intensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexShader:
        'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform vec3 warm; uniform vec3 amber; uniform float intensity; varying vec2 vUv;
      void main(){float r=length(vUv-0.5)*2.0;
        float core=exp(-r*r*110.0); float inner=exp(-r*r*25.0); float haze=exp(-r*r*5.0);
        float alpha=min(1.0,core*0.98+inner*0.45+haze*0.16)*intensity*(1.0-smoothstep(0.7,1.0,r));
        gl_FragColor=vec4(mix(amber,warm,exp(-r*r*36.0)),alpha);
        #include <colorspace_fragment>
      }`,
    }),
  );
  const selectionGlow = new Mesh(geometry(new PlaneGeometry(0.2, 0.2)), selectedLight);
  const selectionDot = new Mesh(
    geometry(new CircleGeometry(0.006, 24)),
    material(
      new MeshBasicMaterial({
        color: 0xf36b45,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    ),
  );
  selectionDot.position.set(0, 0, 0.002);
  selectionGlow.renderOrder = 10;
  selectionTicks.renderOrder = 11;
  selectionRing.renderOrder = 12;
  selectionDot.renderOrder = 13;
  selection.add(selectionGlow, selectionTicks, selectionRing, selectionDot);
  selection.visible = false;
  earth.add(selection);
  const ray = new Raycaster(),
    mouse = new Vector2(),
    projected = new Vector3();
  const cyan = new Color(0xf5f1e8),
    amber = new Color(0xf36b45);
  let hoverFrame = 0;
  let hoverX = 0,
    hoverY = 0;
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
    callbacks.interact?.();
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
    const animated = playing && !reduced && !powerSave;
    markers.material.uniforms.time!.value = animated ? now / 1000 : 0;
    markers.material.uniforms.playing!.value = animated ? 1 : 0;
    rim.material.uniforms.intensity!.value = animated
      ? 0.85 + (0.5 + 0.5 * Math.sin((now / 1000) * 1.8)) * 1.15
      : 1;
    const moving = controls.update();
    updateMarkerSize();
    camera.updateMatrixWorld();
    updateSelectionAppearance(animated ? now / 1000 : null);
    renderer.render(scene, camera);
    if (moving || transition || animated) invalidate();
  }
  function updateSelectionAppearance(time: number | null) {
    const label = callbacks.selectionLabel;
    if (!selection.visible) {
      if (label) label.dataset.visible = 'false';
      return;
    }
    const front = selection.position.dot(camera.position) > 1.04;
    for (const child of selection.children) child.visible = front;
    selectionGlow.visible = front && selectedIsPrecise;
    selectionDot.visible = front && selectedIsPrecise;
    const pulse = time === null ? 1 : 0.5 + 0.5 * Math.sin(time * 1.8);
    selectedLight.uniforms.intensity!.value = 0.58 + pulse * 0.42;
    selectionRing.material.opacity = 0.46 + pulse * 0.52;
    selectionRing.scale.setScalar(time === null ? 1 : 0.98 + pulse * 0.08);
    selectionTicks.material.opacity = 0.16 + pulse * 0.22;
    const pixel =
      (2 *
        camera.position.distanceTo(selection.position) *
        Math.tan((camera.fov * Math.PI) / 360)) /
      height;
    selection.scale.setScalar(((width < 768 ? 28 : 40) * pixel) / 0.052);
    selection.lookAt(camera.position);
    if (label) {
      projected.copy(selection.position).project(camera);
      const x = ((projected.x + 1) * width) / 2,
        y = ((1 - projected.y) * height) / 2;
      const visible =
        front && projected.z < 1 && x > 20 && x < width - 20 && y > 32 && y < height - 32;
      label.dataset.visible = String(visible);
      label.dataset.side = x + (width < 768 ? 168 : 256) > width ? 'left' : 'right';
      label.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }
  function updateMarkerSize() {
    const zoom = Math.min(1.7, 3.8 / camera.position.length());
    const viewportScale = Math.min(1, Math.min(width, height) / 600);
    const size = Math.max(5.8, 8.0 * viewportScale) * zoom;
    // A compact globe packs the same coordinates into fewer pixels.
    markers.material.uniforms.zoom!.value = zoom * Math.max(0.4, viewportScale);
    markers.material.uniforms.pointSize!.value = size * renderer.getPixelRatio();
  }
  function resize() {
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width;
    height = bounds.height;
    const ratio = powerSave ? 1 : Math.min(devicePixelRatio || 1, width < 768 ? 1.5 : 1.75);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    mainland.material.uniforms.pointSize!.value = ratio * 1.2;
    oceanDots.material.uniforms.pointSize!.value = ratio * 1.2;
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
    selectedIsPrecise = position?.precision === 'coordinates';
    if (position) {
      const index = selected ? markerIndices.get(selected.id) : undefined;
      if (index !== undefined)
        selection.position
          .fromArray(positions, index * 3)
          .normalize()
          .multiplyScalar(1.001);
      else
        selection.position.fromArray(globePosition(position.latitude, position.longitude, 1.001));
    }
    invalidate();
  }
  function centerSelection() {
    if (!selection.visible) return;
    showPreview(null);
    moveTo(selection.position.clone().normalize().multiplyScalar(camera.position.length()));
  }
  function rebuildMarkers() {
    allowDwell = false;
    dwell.cancel();
    groups = stationMarkers(sourceGroups);
    markerIndices.clear();
    const coordinates: number[] = [];
    for (const [index, marker] of groups.entries()) {
      for (const station of marker.stations) markerIndices.set(station.id, index);
      const center = new Vector3().fromArray(
        globePosition(marker.latitude, marker.longitude, 1.001),
      );
      coordinates.push(...center.toArray());
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
        groups.map((group) => (group.precision === 'coordinates' ? 0 : 1)),
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
      resize();
    },
    setSelection(station) {
      const changed = selected?.id !== station?.id;
      if (changed) {
        allowDwell = false;
        transition = undefined;
        dwell.cancel();
        showPreview(null);
      }
      selected = station;
      updateSelection();
      if (changed && playing) centerSelection();
    },
    setPlaying(value) {
      const started = value && !playing;
      playing = value;
      if (started) centerSelection();
      invalidate();
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
      cancelAnimationFrame(hoverFrame);
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
      landMask.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      groups = [];
      sourceGroups = [];
      markerIndices.clear();
      selected = null;
      if (callbacks.selectionLabel) callbacks.selectionLabel.dataset.visible = 'false';
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
    if (start || dragging || e.pointerType !== 'mouse' || !active || lost || disposed) return;
    hoverX = e.clientX;
    hoverY = e.clientY;
    if (!hoverFrame)
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!disposed && !lost && active && !dragging && !document.hidden)
          showPreview(pickAt(hoverX, hoverY) ?? null);
      });
  });
  listen(canvas, 'pointerleave', () => {
    cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    if (!dragging) showPreview(null);
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
    const group = pickAt(e.clientX, e.clientY);
    if (group) {
      showPreview(group);
      callbacks.pick(sourceGroups.find((source) => source.id === group.groupId) ?? group, 'click');
    }
  });
  function pickAt(clientX: number, clientY: number) {
    const bounds = canvas.getBoundingClientRect();
    mouse.set(
      ((clientX - bounds.left) / width) * 2 - 1,
      (-(clientY - bounds.top) / height) * 2 + 1,
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
    return hit?.index === undefined ? undefined : groups[hit.index];
  }
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
    callbacks.interact?.();
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
