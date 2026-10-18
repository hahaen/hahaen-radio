import {
  BufferGeometry,
  Float32BufferAttribute,
  PerspectiveCamera,
  Points,
  PointsMaterial,
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
  const objects = clouds.map((cloud, index) => {
    const row = Math.floor(index / 4),
      column = index % 4;
    const center = new Vector3(
      (column - 1.5) * 1.65 + (row === 2 ? 0.8 : 0),
      1.7 - row * 1.65,
      ((index % 3) - 1) * 0.35,
    );
    const positions: number[] = [];
    const count = Math.min(powerSave ? 90 : 220, cloud.count);
    for (let i = 0; i < count; i++) {
      const angle = i * 2.3999632297;
      const radius = Math.sqrt((i + 0.5) / count) * 0.58;
      positions.push(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.72,
        Math.sin(i * 7.13) * 0.28,
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: index % 4 === 0 ? 0xd8ad6b : 0x83aaa3,
      size: powerSave ? 0.025 : 0.018,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.position.copy(center);
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
      object.center.set(
        (column - (inRow - 1) / 2) * (compact ? 2.5 : 1.65),
        (compact ? 2.8 : 1.7) - row * (compact ? 1.85 : 1.65),
        ((index % 3) - 1) * 0.35,
      );
      object.points.position.copy(object.center);
    }
    camera.position.z = width < 500 ? 11.2 : 9.5;
    // Keep the same complete cloud field visible in a narrow portrait viewport.
    camera.fov = width < 500 ? 49 : 38;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(powerSave ? 1 : Math.min(devicePixelRatio || 1, 1.5));
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
