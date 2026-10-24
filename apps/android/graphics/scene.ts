import { createGlobe, type GlobeController } from '../../web/src/graphics/globe';
import { createImmersionScene } from '../../web/src/graphics/immersion-scene';
import { loadLand } from '../../web/src/graphics/land';
import { groupStations } from '../../web/src/graphics/model';
import type { StationPreview } from '../../../packages/contracts/src/scene';
import { createStarfield } from './starfield';

declare global {
  interface Window {
    HaenNative?: { postMessage(message: string): void };
    haenReceive?: (message: Message) => void;
  }
}
type Snapshot = {
  station: StationPreview | null;
  playing: boolean;
  pinned: boolean;
  active: boolean;
  powerSave: boolean;
  scene: string;
};
type Message = {
  version: number;
  type: string;
  active?: boolean;
  items?: StationPreview[];
  snapshot?: Snapshot;
};
const host = document.querySelector<HTMLElement>('#scene')!;
const starfield = createStarfield(host);
const immersionHost = document.createElement('div');
immersionHost.id = 'immersion-scene';
host.parentElement!.append(immersionHost);
function showLayer(layer: HTMLElement, visible: boolean) {
  // Preserve layout dimensions so a hidden layer never measures as a zero-sized viewport.
  layer.style.visibility = visible ? 'visible' : 'hidden';
  layer.style.pointerEvents = visible ? '' : 'none';
  layer.inert = !visible;
  layer.setAttribute('aria-hidden', String(!visible));
}
showLayer(immersionHost, false);
// Android WebView can initially resolve percentage and viewport CSS heights to zero.
// Use its visible viewport and let the shared renderer's ResizeObserver resize the canvas.
const sizeViewport = () => {
  document.documentElement.style.height = `${window.innerHeight}px`;
  document.body.style.height = `${window.innerHeight}px`;
  const stage = document.querySelector<HTMLElement>('#stage')!;
  stage.style.width = `${window.innerWidth}px`;
  const portrait = window.innerHeight >= window.innerWidth;
  stage.style.height = `${window.innerHeight * (portrait ? 0.84 : 0.66)}px`;
  host.style.width = `${window.innerWidth}px`;
  host.style.height = `${window.innerHeight}px`;
  immersionHost.style.width = `${window.innerWidth}px`;
  immersionHost.style.height = `${window.innerHeight}px`;
};
sizeViewport();
window.addEventListener('resize', sizeViewport);
const send = (type: string, id?: string) =>
  window.HaenNative?.postMessage(JSON.stringify({ version: 1, type, id }));
let globe: GlobeController | undefined;
let immersion: ReturnType<typeof createImmersionScene> | undefined;
let stations: StationPreview[] = [];
let snapshot: Snapshot = {
  station: null,
  playing: false,
  pinned: false,
  active: true,
  powerSave: false,
  scene: 'globe',
};
let disposed = false;
let sceneGeneration = 0;
let globeGeneration = 0;
let globeLost = false;
let immersionLost = false;
let stationsRevision = 0;
let appliedStationsRevision = -1;
let appliedGlobePowerSave: boolean | undefined;
let immersionOptions: Parameters<NonNullable<typeof immersion>['update']>[0] | undefined;
const contextListeners: (() => void)[] = [];
const abort = new AbortController();
const land = loadLand(abort.signal);
function updateGlobeData() {
  if (!globe || globeLost || appliedStationsRevision === stationsRevision) return;
  globe.setData(groupStations(stations));
  appliedStationsRevision = stationsRevision;
}
function reportLoss(scene: 'globe' | 'immersion') {
  if (!disposed && snapshot.active && (snapshot.scene === 'globe') === (scene === 'globe'))
    send('lost');
}
function updateImmersion(visible: boolean) {
  if (!immersion) return;
  const mode =
    snapshot.scene === 'mountains'
      ? 'dunes'
      : snapshot.scene === 'aurora'
        ? 'aurora'
        : snapshot.scene === 'globe'
          ? (immersionOptions?.mode ?? 'ocean')
          : 'ocean';
  const next = {
    mode,
    playing: visible && snapshot.playing,
    powerSave: snapshot.powerSave || !visible,
  } as const;
  if (
    next.mode !== immersionOptions?.mode ||
    next.playing !== immersionOptions?.playing ||
    next.powerSave !== immersionOptions?.powerSave
  ) {
    immersion.update(next);
    immersionOptions = next;
  }
}
async function render() {
  const generation = ++sceneGeneration;
  const showGlobe = snapshot.scene === 'globe';
  const visible = snapshot.active;
  showLayer(host, showGlobe && visible);
  showLayer(immersionHost, !showGlobe && visible);
  if (!showGlobe || !visible) globe?.setActive(false);
  if (showGlobe || !visible) updateImmersion(false);
  starfield.update({
    visible: showGlobe && visible,
    animated: snapshot.playing && !snapshot.powerSave,
  });
  if (!visible) return;
  try {
    if (showGlobe) {
      if (!globe) {
        const data = await land;
        if (disposed || generation !== sceneGeneration) return;
        const instance = ++globeGeneration;
        appliedGlobePowerSave = undefined;
        globe = createGlobe(host, data, {
          label: 'HAEN globe',
          pick: (group) => {
            const station = group.stations[0];
            if (station) send('select', station.id);
          },
          preview: () => {},
          interact: () => send('interact'),
          lost: () => {
            if (disposed || instance !== globeGeneration) return;
            globeLost = true;
            reportLoss('globe');
          },
          restored: () => {
            if (disposed || instance !== globeGeneration) return;
            // The shared globe reports restoration to its owner but retains its lost flag.
            // Recreate only this failed cache, never the healthy scene on a normal return.
            globeGeneration++;
            globe?.destroy();
            globe = undefined;
            globeLost = false;
            appliedStationsRevision = -1;
            appliedGlobePowerSave = undefined;
            if (snapshot.scene === 'globe' && snapshot.active) {
              send('restored');
              void render();
            }
          },
        });
      }
      if (globeLost) {
        reportLoss('globe');
        return;
      }
      updateGlobeData();
      // The shared setter replaces the terrain index, even when its value is unchanged.
      if (appliedGlobePowerSave !== snapshot.powerSave) {
        globe.setPowerSave(snapshot.powerSave);
        appliedGlobePowerSave = snapshot.powerSave;
      }
      globe.setSelection(snapshot.station);
      globe.setPinned(snapshot.pinned);
      globe.setPlaying(snapshot.playing);
      globe.setActive(true);
    } else {
      if (!immersion) {
        immersionOptions = { mode: 'ocean', playing: false, powerSave: true };
        immersion = createImmersionScene(immersionHost, immersionOptions);
        const canvas = immersionHost.querySelector('canvas')!;
        const lost = () => {
          immersionLost = true;
          reportLoss('immersion');
        };
        const restored = () => {
          if (disposed) return;
          immersionLost = false;
          if (snapshot.scene !== 'globe' && snapshot.active) send('restored');
        };
        canvas.addEventListener('webglcontextlost', lost);
        canvas.addEventListener('webglcontextrestored', restored);
        contextListeners.push(() => {
          canvas.removeEventListener('webglcontextlost', lost);
          canvas.removeEventListener('webglcontextrestored', restored);
        });
      }
      if (immersionLost) {
        reportLoss('immersion');
        return;
      }
      updateImmersion(true);
    }
  } catch {
    if (!disposed && generation === sceneGeneration && snapshot.active) send('lost');
  }
}
window.haenReceive = (message) => {
  if (message.version !== 1 || disposed) return;
  switch (message.type) {
    case 'reset':
      stations = [];
      break;
    case 'batch':
      if (
        message.items &&
        message.items.length <= 250 &&
        stations.length + message.items.length <= 200000
      )
        stations.push(...message.items);
      break;
    case 'complete':
      stationsRevision++;
      if (snapshot.scene === 'globe') updateGlobeData();
      break;
    case 'snapshot':
      if (message.snapshot) {
        snapshot = message.snapshot;
        void render();
      }
      break;
    case 'active':
      if (typeof message.active === 'boolean') {
        snapshot = { ...snapshot, active: message.active };
        void render();
      }
      break;
    case 'destroy':
      disposed = true;
      sceneGeneration++;
      globeGeneration++;
      window.removeEventListener('resize', sizeViewport);
      abort.abort();
      globe?.destroy();
      contextListeners.forEach((remove) => remove());
      immersion?.destroy();
      immersionHost.remove();
      starfield.destroy();
      window.removeEventListener('error', onError);
      break;
  }
};
const onError = () => send('lost');
window.addEventListener('error', onError);
send('ready');
