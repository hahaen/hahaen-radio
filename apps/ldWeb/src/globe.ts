export type Land = { polygons: [number, number][][][] };

export interface MapStation {
  id: string;
  latitude: number;
  longitude: number;
}

const radians = Math.PI / 180;
const size = 416;
const center = size / 2;
const radius = 178;
const textureWidth = 1024;
const textureHeight = 512;

function landTexture(land: Land) {
  const texture = document.createElement('canvas');
  texture.width = textureWidth;
  texture.height = textureHeight;
  const context = texture.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = '#fff';
  for (const polygon of land.polygons) {
    context.beginPath();
    for (const ring of polygon) {
      ring.forEach(([longitude, latitude], index) => {
        const x = ((longitude + 180) / 360) * textureWidth;
        const y = ((90 - latitude) / 180) * textureHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
    }
    context.fill('evenodd');
  }
  return context.getImageData(0, 0, textureWidth, textureHeight).data;
}

export function mountGlobe(
  canvas: HTMLCanvasElement,
  land: Land,
  stations: readonly MapStation[],
  onSelect: (id: string) => void,
) {
  const target = canvas.getContext('2d');
  const raster = landTexture(land);
  if (!target || !raster) return null;
  const context = target;
  const texture = raster;
  const points = new Map<string, MapStation>();
  for (const station of stations) {
    const key = `${Math.round(station.latitude)},${Math.round(station.longitude)}`;
    if (!points.has(key)) points.set(key, station);
  }

  canvas.width = size;
  canvas.height = size;
  const image = context.createImageData(size, size);
  const glow = context.createRadialGradient(center, center, radius * 0.96, center, center, center);
  glow.addColorStop(0, '#7dba9d38');
  glow.addColorStop(1, '#7dba9d00');
  let longitude = 0;
  let latitude = 0;
  let selected: MapStation | undefined;
  let frame = 0;
  let markers: { id: string; x: number; y: number }[] = [];
  let pointer: { id: number; x: number; y: number; distance: number } | undefined;

  function draw() {
    frame = 0;
    const sinLatitude = Math.sin(latitude);
    const cosLatitude = Math.cos(latitude);
    const pixels = image.data;
    for (let row = center - radius; row < center + radius; row++) {
      const y = (center - row - 0.5) / radius;
      for (let column = center - radius; column < center + radius; column++) {
        const x = (column + 0.5 - center) / radius;
        const depth = 1 - x * x - y * y;
        if (depth <= 0) continue;
        const z = Math.sqrt(depth);
        const lat = Math.asin(Math.max(-1, Math.min(1, y * cosLatitude + z * sinLatitude)));
        const lon = longitude + Math.atan2(x, z * cosLatitude - y * sinLatitude);
        const u = (((lon / (2 * Math.PI) + 0.5) % 1) + 1) % 1;
        const v = 0.5 - lat / Math.PI;
        const offset =
          (Math.min(textureHeight - 1, Math.floor(v * textureHeight)) * textureWidth +
            Math.floor(u * textureWidth)) *
          4;
        const landAmount = (texture[offset + 3] ?? 0) / 255;
        const light = 0.5 + 0.46 * Math.max(0, -x * 0.42 + y * 0.26 + z * 0.83);
        const grid =
          Math.abs(Math.sin(lon * 12)) < 0.022 || Math.abs(Math.sin(lat * 12)) < 0.022 ? 4 : 0;
        const rim = 8 * (1 - z) ** 4;
        const pixel = (row * size + column) * 4;
        pixels[pixel] = (12 + landAmount * 26) * light + grid + rim;
        pixels[pixel + 1] = (29 + landAmount * 45) * light + grid + rim;
        pixels[pixel + 2] = (25 + landAmount * 37) * light + grid + rim;
        pixels[pixel + 3] = Math.min(255, depth * radius * 255);
      }
    }
    context.putImageData(image, 0, 0);
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
    context.beginPath();
    context.arc(center, center, radius, 0, 2 * Math.PI);
    context.strokeStyle = '#91aaa060';
    context.stroke();

    markers = [];
    for (const station of selected ? [...points.values(), selected] : points.values()) {
      const lat = station.latitude * radians;
      const delta = station.longitude * radians - longitude;
      const sin = Math.sin(lat);
      const cos = Math.cos(lat);
      const facing = sin * sinLatitude + cos * cosLatitude * Math.cos(delta);
      if (facing < 0.025) continue;
      const x = center + radius * cos * Math.sin(delta);
      const y = center - radius * (sin * cosLatitude - cos * Math.cos(delta) * sinLatitude);
      markers.push({ id: station.id, x, y });
      const active = station.id === selected?.id;
      context.beginPath();
      context.arc(x, y, active ? 7 : 1.6, 0, 2 * Math.PI);
      if (active) {
        context.strokeStyle = '#f36b45';
        context.stroke();
      } else {
        context.fillStyle = '#a8deab65';
        context.fill();
      }
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function rotate(horizontal: number, vertical: number) {
    longitude = (longitude + horizontal) % (Math.PI * 2);
    latitude = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, latitude + vertical));
    schedule();
  }
  const down = (event: PointerEvent) => {
    if (pointer || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (pointer?.id !== event.pointerId) return;
    const x = event.clientX - pointer.x;
    const y = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.distance += Math.hypot(x, y);
    if (pointer.distance >= 5) rotate(-x * 0.012, y * 0.012);
  };
  const cancel = (event: PointerEvent) => {
    if (pointer?.id === event.pointerId) pointer = undefined;
  };
  const up = (event: PointerEvent) => {
    if (pointer?.id !== event.pointerId) return;
    if (pointer.distance < 5) {
      const bounds = canvas.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * size;
      const y = ((event.clientY - bounds.top) / bounds.height) * size;
      const nearest = markers
        .map((marker) => ({ id: marker.id, distance: Math.hypot(x - marker.x, y - marker.y) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest && nearest.distance < 18) onSelect(nearest.id);
    }
    cancel(event);
  };
  const keydown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowLeft':
        rotate(-0.16, 0);
        break;
      case 'ArrowRight':
        rotate(0.16, 0);
        break;
      case 'ArrowUp':
        rotate(0, 0.16);
        break;
      case 'ArrowDown':
        rotate(0, -0.16);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const events = new AbortController();
  const options = { signal: events.signal };
  canvas.addEventListener('pointerdown', down, options);
  canvas.addEventListener('pointermove', move, options);
  canvas.addEventListener('pointerup', up, options);
  canvas.addEventListener('pointercancel', cancel, options);
  canvas.addEventListener('lostpointercapture', cancel, options);
  canvas.addEventListener('keydown', keydown, options);
  return {
    focus(station: MapStation | undefined) {
      selected = station;
      if (station) {
        latitude = station.latitude * radians;
        longitude = station.longitude * radians;
      }
      schedule();
    },
    close() {
      events.abort();
      cancelAnimationFrame(frame);
    },
  };
}
