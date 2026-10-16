export class TuningSound {
  private context: AudioContext | undefined;
  private tones = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  private disposed = false;
  private generation = 0;
  private active = false;
  activate() {
    if (this.disposed || typeof AudioContext !== 'function') return;
    try {
      this.context ??= new AudioContext();
      this.active = true;
      if (this.context.state !== 'closed') this.resume(this.context);
    } catch {
      /* Optional sound never affects the station. */
    }
  }
  private resume(context: AudioContext) {
    return context
      .resume()
      .then(() => {
        if (!this.active && context.state === 'running') return context.suspend();
      })
      .catch(() => {});
  }
  play(volume: number, muted: boolean) {
    const context = this.context;
    if (!context || muted || volume <= 0 || this.disposed) return;
    this.stop();
    this.active = true;
    const generation = this.generation;
    const render = () => {
      if (this.disposed || generation !== this.generation || context.state !== 'running') return;
      try {
        const oscillator = context.createOscillator(),
          gain = context.createGain(),
          now = context.currentTime;
        const tone = { oscillator, gain };
        this.tones.add(tone);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(180, now);
        oscillator.frequency.exponentialRampToValueAtTime(90, now + 0.1);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(Math.min(1, volume) * 0.025, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.00001, now + 0.1);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
          this.tones.delete(tone);
        };
        oscillator.start(now);
        oscillator.stop(now + 0.11);
      } catch {
        this.stop();
      }
    };
    if (context.state === 'running') render();
    else
      void this.resume(context)
        .then(render)
        .catch(() => {});
  }
  stop() {
    this.generation++;
    for (const tone of this.tones) {
      tone.oscillator.onended = null;
      try {
        tone.oscillator.stop();
      } catch {
        /* Already ended. */
      }
      tone.oscillator.disconnect();
      tone.gain.disconnect();
    }
    this.tones.clear();
  }
  pause() {
    this.active = false;
    this.stop();
    if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
  }
  destroy() {
    this.disposed = true;
    this.active = false;
    this.stop();
    const context = this.context;
    this.context = undefined;
    if (context) void context.close().catch(() => {});
  }
}
