import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStation } from '../testing/stations';
import { AudioEngine } from './engine';
import { createPlayerController } from './controller';
import type { StationDetail } from '@haen/contracts';

const players: ReturnType<typeof createPlayerController>[] = [];
function harness(
  station: (id: string, signal: AbortSignal) => Promise<StationDetail> = async (id) =>
    testStation(Number(id.slice(-12))),
) {
  const media: HTMLAudioElement[] = [];
  const controller = createPlayerController({
    station,
    createEngine: () =>
      new AudioEngine({
        createMedia: () => {
          const audio = document.createElement('audio');
          vi.spyOn(audio, 'play').mockResolvedValue();
          vi.spyOn(audio, 'pause').mockImplementation(() => {});
          vi.spyOn(audio, 'load').mockImplementation(() => {});
          media.push(audio);
          return audio;
        },
      }),
  });
  players.push(controller);
  controller.attach();
  const playing = () => media.at(-1)!.dispatchEvent(new Event('playing'));
  return { controller, media, playing };
}
afterEach(() => {
  for (const controller of players.splice(0)) controller.detach();
  vi.useRealTimers();
});
describe('playback coordination', () => {
  it('ignores a cancelled station response after another selection wins', async () => {
    let finish: (value: StationDetail) => void = () => {};
    const { controller } = harness(async (id) =>
      id === testStation(1).id
        ? await new Promise((resolve) => {
            finish = resolve;
          })
        : testStation(2),
    );
    const first = controller.select(testStation(1));
    await controller.select(testStation(2));
    finish(testStation(1));
    await first;
    expect(controller.store.getState()).toMatchObject({
      station: { id: testStation(2).id },
      resolving: false,
      playback: { stationId: testStation(2).id, status: 'connecting' },
    });
  });
  it('ignores a queued pause from the old station while the new selection loads', async () => {
    let finish: (value: StationDetail) => void = () => {};
    const { controller, media, playing } = harness(async (id) =>
      id === testStation(2).id
        ? await new Promise((resolve) => {
            finish = resolve;
          })
        : testStation(1),
    );
    await controller.select(testStation(1));
    playing();
    const old = media[0]!;
    const loading = controller.select(testStation(2));
    old.dispatchEvent(new Event('pause'));
    expect(controller.store.getState().intent).toBe(true);
    finish(testStation(2));
    await loading;
    expect(media).toHaveLength(2);
    playing();
    expect(controller.store.getState()).toMatchObject({
      station: { id: testStation(2).id },
      intent: true,
      playback: { status: 'playing' },
    });
  });
  it('honors pause while station details are still loading', async () => {
    let finish: (value: StationDetail) => void = () => {};
    const { controller, media } = harness(
      async () =>
        await new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = controller.select(testStation(1));
    controller.pause();
    finish(testStation(1));
    await loading;
    expect(controller.store.getState().playback.status).toBe('paused');
    expect(media).toHaveLength(0);
  });
  it('survives lifecycle replay and resumes the selected station only after a new explicit play', async () => {
    const { controller, media, playing } = harness();
    await controller.select(testStation(1));
    playing();
    controller.detach();
    controller.attach();
    expect(controller.store.getState().playback.status).toBe('paused');
    expect(media).toHaveLength(1);
    controller.play();
    expect(media).toHaveLength(2);
    playing();
    expect(controller.store.getState().playback.status).toBe('playing');
  });
  it('returns through successful visits and does not include a failed attempt', async () => {
    const { controller, playing } = harness(async (id) => {
      if (id === testStation(3).id) throw new Error('Unavailable');
      return testStation(Number(id.slice(-12)));
    });
    await controller.select(testStation(1));
    playing();
    await controller.select(testStation(2));
    playing();
    await controller.select(testStation(3));
    controller.previous();
    await Promise.resolve();
    expect(controller.store.getState().station?.id).toBe(testStation(2).id);
    playing();
    controller.previous();
    await Promise.resolve();
    expect(controller.store.getState().station?.id).toBe(testStation(1).id);
  });
  it('limits automatic recovery to two extra stations and never repeats after a volume change', async () => {
    vi.useFakeTimers();
    const { controller, media } = harness();
    const explorer = vi.fn<Parameters<typeof controller.setExplorer>[0]>(async () =>
      testStation(10 + media.length),
    );
    controller.setExplorer(explorer);
    await controller.select(testStation(1));
    await vi.advanceTimersByTimeAsync(24001);
    expect(explorer).toHaveBeenCalledTimes(2);
    expect(explorer.mock.calls.map((call) => call[1])).toEqual([
      [testStation(1).id],
      [testStation(1).id, testStation(11).id],
    ]);
    expect(media).toHaveLength(3);
    expect(controller.store.getState()).toMatchObject({
      autoSkips: 2,
      playback: { status: 'failed' },
    });
    controller.setVolume(0.5);
    await vi.advanceTimersByTimeAsync(60000);
    expect(explorer).toHaveBeenCalledTimes(2);
  });
  it('preserves a pinned station on failure and still permits explicit station changes', async () => {
    vi.useFakeTimers();
    const { controller } = harness();
    const explorer = vi.fn(async () => testStation(2));
    controller.setExplorer(explorer);
    controller.setPinned(true);
    await controller.select(testStation(1));
    await vi.advanceTimersByTimeAsync(9000);
    expect(explorer).not.toHaveBeenCalled();
    expect(controller.store.getState().station?.id).toBe(testStation(1).id);
    await controller.next();
    expect(controller.store.getState().station?.id).toBe(testStation(2).id);
  });
});
