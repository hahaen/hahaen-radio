import {
  AdditiveBlending,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export interface GenreCloud {
  id: string;
  count: number;
  label: HTMLElement;
}
export function createGenreScene(host: HTMLElement, clouds: GenreCloud[], powerSave: boolean) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !powerSave,
    powerPreference: 'low-power',
  });
  const scene = new Scene(),
    camera = new PerspectiveCamera(38, 1, 0.1, 30);
  camera.position.set(0, 0, 9.5);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minDistance = 7;
  controls.maxDistance = 12;
  controls.minAzimuthAngle = -0.45;
  controls.maxAzimuthAngle = 0.45;
  controls.minPolarAngle = Math.PI / 2 - 0.25;
  controls.maxPolarAngle = Math.PI / 2 + 0.25;
  const layout = [
    [-3.0, -0.15],
    [-2.6, 0.4],
    [3.25, 0.5],
    [-2.1, 1.8],
    [-0.65, 0.75],
    [0.1, -1.25],
    [-2.8, -2.0],
    [1.9, 1.7],
    [0.7, 1.2],
    [2.8, -1.0],
    [2.65, -1.3],
  ] as const;
  const objects = clouds.map((cloud, index) => {
    const center = new Vector3();
    const positions: number[] = [];
    const count = Math.min(powerSave ? 180 : 6000, cloud.count);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.3999632297 + index * 0.7;
      const radius =
        Math.pow((i + 0.5) / count, 0.8) *
        (0.35 + Math.sqrt(Math.min(cloud.count, 15000) / 15000) * 0.8);
      positions.push(
        Math.cos(angle + radius * 4.5) * radius,
        Math.sin(angle + radius * 4.5) * radius * (0.45 + (index % 4) * 0.08),
        Math.sin(i * 7.13) * radius * 0.42,
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new ShaderMaterial({
      uniforms: {
        tint: {
          value: new Color(
            [
              0x9cadac, 0xcf9694, 0x95aecb, 0xcf9b83, 0x8ac6bd, 0xc4b363, 0xc0af98, 0xd4cfad,
              0xd8ad6b, 0xa6bd91, 0x83aaa3,
            ][index % 11]!,
          ),
        },
        pointSize: { value: powerSave ? 1.7 : 2.8 },
      },
      vertexShader: `uniform float pointSize; varying float vAlpha;
        void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
          float seed=fract(sin(dot(position,vec3(12.98,78.23,37.71)))*43758.54);
          vAlpha=0.45+seed*0.55;
          gl_PointSize=pointSize*(0.65+seed)*9.5/max(2.0,-p.z);
          gl_Position=projectionMatrix*p;}`,
      fragmentShader: `uniform vec3 tint; varying float vAlpha;
        void main(){float d=length(gl_PointCoord-0.5);if(d>0.5)discard;
          float halo=exp(-d*d*24.0);
          gl_FragColor=vec4(tint,halo*vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.position.copy(center);
    points.rotation.z = [0.35, -0.2, 0.15, -0.4][index % 4]!;
    scene.add(points);
    return { points, center, label: cloud.label };
  });
  let frame = 0,
    disposed = false,
    lost = false;
  const projected = new Vector3();
  const draw = () => {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const { width, height } = host.getBoundingClientRect();
    camera.updateMatrixWorld();
    for (const { center, label } of objects) {
      projected.copy(center).project(camera);
      label.style.left = `${((projected.x + 1) * width) / 2}px`;
      label.style.top = `${((1 - projected.y) * height) / 2}px`;
    }
    renderer.render(scene, camera);
  };
  const invalidate = () => {
    if (!frame && !disposed && !lost && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    const compact = camera.aspect < 0.95,
      columns = compact ? 3 : 4;
    for (const [index, object] of objects.entries()) {
      const row = Math.floor(index / columns),
        column = index % columns;
      const inRow = Math.min(columns, objects.length - row * columns);
      const [x, y] = layout[index % layout.length]!;
      object.center.set(
        compact ? (column - (inRow - 1) / 2) * 2.5 : x,
        compact ? 2.8 - row * 1.85 : y,
        ((index % 3) - 1) * 0.35,
      );
      object.points.position.copy(object.center);
    }
    camera.position.z = width < 500 ? 11.2 : 9.5;
    // Keep the same complete cloud field visible in a narrow portrait viewport.
    camera.fov = width < 500 ? 49 : 38;
    camera.updateProjectionMatrix();
    const ratio = powerSave ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(ratio);
    for (const object of objects)
      object.points.material.uniforms.pointSize!.value = (powerSave ? 1.7 : 2.8) * ratio;
    renderer.setSize(width, height, false);
    invalidate();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    host.dataset.rendered = 'false';
  };
  const restored = () => {
    lost = false;
    host.dataset.rendered = 'true';
    invalidate();
  };
  const visibility = () => {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  };
  controls.addEventListener('change', invalidate);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  const observer = new ResizeObserver(resize);
  host.prepend(canvas);
  host.dataset.rendered = 'true';
  observer.observe(host);
  resize();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    controls.removeEventListener('change', invalidate);
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', restored);
    document.removeEventListener('visibilitychange', visibility);
    for (const { points, label } of objects) {
      points.geometry.dispose();
      points.material.dispose();
      label.style.removeProperty('left');
      label.style.removeProperty('top');
    }
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    delete host.dataset.rendered;
  };
}
