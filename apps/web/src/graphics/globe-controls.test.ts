import { afterEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { GlobeControls } from './globe-controls.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const canvas = document.createElement('canvas');
  canvas.style.touchAction = 'pan-y';
  const captures = new Set<number>();
  canvas.setPointerCapture = (id) => {
    captures.add(id);
  };
  canvas.releasePointerCapture = (id) => {
    captures.delete(id);
  };
  canvas.hasPointerCapture = (id) => captures.has(id);
  Object.defineProperty(canvas, 'clientHeight', { value: 600 });
  const camera = new PerspectiveCamera();
  camera.position.set(0, 0, 3.8);
  camera.lookAt(0, 0, 0);
  const controls = new GlobeControls(camera, canvas);
  controls.enableDamping = false;
  cleanups.push(() => controls.dispose());
  const pointer = (type: string, id: number, x: number, y: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch' }),
    );
  return { controls, camera, canvas, captures, pointer };
}

describe('continuous globe interaction', () => {
  it('crosses both poles and returns after a complete vertical revolution', () => {
    const { camera, pointer } = setup();
    const initial = camera.position.clone();
    pointer('pointerdown', 1, 200, 400);
    for (let step = 1; step <= 24; step++) {
      const before = camera.position.clone();
      pointer('pointermove', 1, 200, 400 - step * 25);
      expect(camera.position.distanceTo(before)).toBeGreaterThan(0.9);
      expect(camera.position.length()).toBeCloseTo(3.8, 10);
      expect(camera.up.dot(camera.position)).toBeCloseTo(0, 10);
    }
    expect(camera.position.distanceTo(initial)).toBeLessThan(1e-10);
    expect(camera.up.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-10);
  });

  it('keeps diagonal and horizontal gestures responsive after crossing a pole', () => {
    const { camera, pointer } = setup();
    pointer('pointerdown', 1, 200, 400);
    pointer('pointermove', 1, 200, 200);
    for (const [x, y] of [
      [250, 200],
      [280, 170],
      [230, 170],
      [200, 200],
    ]) {
      const before = camera.position.clone();
      pointer('pointermove', 1, x!, y!);
      expect(camera.position.distanceTo(before)).toBeGreaterThan(0.5);
    }
  });

  it('bounds pinch and wheel zoom and resumes one-finger rotation without a jump', () => {
    const { camera, canvas, pointer, controls } = setup();
    pointer('pointerdown', 1, 150, 200);
    pointer('pointerdown', 2, 250, 200);
    pointer('pointermove', 2, 1150, 200);
    expect(camera.position.length()).toBeCloseTo(controls.minDistance);
    pointer('pointerup', 2, 1150, 200);
    const before = camera.position.clone();
    pointer('pointermove', 1, 150, 200);
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-10);
    pointer('pointermove', 1, 170, 200);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.2);
    for (let step = 0; step < 10; step++)
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000 }));
    expect(camera.position.length()).toBeCloseTo(controls.maxDistance);
  });

  it('releases a cancelled multi-touch gesture and accepts the next drag', () => {
    const { camera, pointer, captures } = setup();
    pointer('pointerdown', 1, 150, 200);
    pointer('pointerdown', 2, 250, 200);
    pointer('pointercancel', 1, 150, 200);
    expect(captures.size).toBe(0);
    const before = camera.position.clone();
    pointer('pointerdown', 3, 150, 200);
    pointer('pointermove', 3, 200, 200);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.5);
  });

  it('settles inertia and stops it when the scene is deactivated', () => {
    const { camera, controls } = setup();
    controls.enableDamping = true;
    controls.rotate(0.2, 0.3);
    const before = camera.position.clone();
    expect(controls.update()).toBe(true);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
    for (let step = 0; step < 300; step++) controls.update();
    expect(controls.update()).toBe(false);
    controls.rotate(0.3, 0.2);
    controls.enabled = false;
    const paused = camera.position.clone();
    controls.update();
    expect(camera.position.distanceTo(paused)).toBeLessThan(1e-10);
  });

  it('removes listeners and capture when disposed during a drag', () => {
    const { camera, pointer, controls, captures, canvas } = setup();
    pointer('pointerdown', 1, 150, 200);
    controls.dispose();
    expect(captures.size).toBe(0);
    const before = camera.position.clone();
    pointer('pointermove', 1, 200, 200);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000 }));
    expect(camera.position.distanceTo(before)).toBeLessThan(1e-10);
    expect(canvas.style.touchAction).toBe('pan-y');
  });
});
