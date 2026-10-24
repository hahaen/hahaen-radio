import { EventDispatcher, PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';

/** Screen-relative rotation transports camera up through the poles without a latitude clamp. */
export class GlobeControls extends EventDispatcher<{ change: object; start: object; end: object }> {
  minDistance = 1.22;
  maxDistance = 5.5;
  enableDamping = true;
  dampingFactor = 0.09;
  private active = true;
  private readonly pointers = new Map<number, Vector2>();
  private readonly rotation = new Vector2();
  private readonly axis = new Vector3();
  private readonly right = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly lastPosition = new Vector3();
  private readonly lastUp = new Vector3();
  private readonly origin = new Vector3();
  private readonly previousTouchAction: string;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {
    super();
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    this.lastPosition.copy(camera.position);
    this.lastUp.copy(camera.up);
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('lostpointercapture', this.up);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
  }

  get enabled() {
    return this.active;
  }
  set enabled(value: boolean) {
    this.active = value;
    if (!value) this.cancel();
  }

  stop() {
    this.rotation.set(0, 0);
  }

  rotate(x: number, y: number) {
    this.rotation.x += x;
    this.rotation.y += y;
    this.update();
  }

  update(): boolean {
    if (this.rotation.lengthSq() > 1e-12) {
      const factor = this.enableDamping ? this.dampingFactor : 1;
      this.right.crossVectors(this.camera.up, this.camera.position).normalize();
      this.axis
        .copy(this.camera.up)
        .normalize()
        .multiplyScalar(-this.rotation.x)
        .addScaledVector(this.right, -this.rotation.y);
      this.quaternion.setFromAxisAngle(this.axis.normalize(), this.rotation.length() * factor);
      this.camera.position.applyQuaternion(this.quaternion);
      this.camera.up.applyQuaternion(this.quaternion).normalize();
      this.rotation.multiplyScalar(1 - factor);
    } else this.stop();
    this.camera.position.setLength(
      Math.max(this.minDistance, Math.min(this.maxDistance, this.camera.position.length())),
    );
    this.camera.lookAt(this.origin);
    const changed =
      this.lastPosition.distanceToSquared(this.camera.position) > 1e-12 ||
      this.lastUp.distanceToSquared(this.camera.up) > 1e-12;
    if (changed) {
      this.lastPosition.copy(this.camera.position);
      this.lastUp.copy(this.camera.up);
      this.dispatchEvent({ type: 'change' });
    }
    return changed;
  }

  private down = (event: PointerEvent) => {
    if (!this.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!this.pointers.size) {
      this.stop();
      this.dispatchEvent({ type: 'start' });
    }
    this.pointers.set(event.pointerId, new Vector2(event.clientX, event.clientY));
    if (this.pointers.size > 1) this.stop();
    this.canvas.setPointerCapture(event.pointerId);
  };

  private move = (event: PointerEvent) => {
    const point = this.pointers.get(event.pointerId);
    if (!this.active || !point) return;
    if (this.pointers.size === 1) {
      const scale = (2 * Math.PI) / Math.max(1, this.canvas.clientHeight);
      const x = (event.clientX - point.x) * scale;
      const y = (event.clientY - point.y) * scale;
      point.set(event.clientX, event.clientY);
      this.rotate(x, y);
    } else {
      const [a, b] = [...this.pointers.values()];
      const before = a!.distanceTo(b!);
      point.set(event.clientX, event.clientY);
      const after = a!.distanceTo(b!);
      if (before > 0 && after > 0) this.camera.position.multiplyScalar(before / after);
      this.update();
    }
  };

  private up = (event: PointerEvent) => {
    if (!this.pointers.delete(event.pointerId)) return;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (!this.pointers.size) this.dispatchEvent({ type: 'end' });
  };

  private wheel = (event: WheelEvent) => {
    if (!this.active) return;
    event.preventDefault();
    this.dispatchEvent({ type: 'start' });
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1;
    this.camera.position.multiplyScalar(
      Math.exp(Math.max(-1, Math.min(1, event.deltaY * scale * 0.001))),
    );
    this.update();
    this.dispatchEvent({ type: 'end' });
  };

  cancel = () => {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.stop();
    for (const id of ids)
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    if (ids.length) this.dispatchEvent({ type: 'end' });
  };

  dispose() {
    this.cancel();
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel);
    this.canvas.removeEventListener('lostpointercapture', this.up);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.style.touchAction = this.previousTouchAction;
  }
}
