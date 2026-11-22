// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the sounds, synthesised with WebAudio (no sound files): the tools at work, the
 * repairs, the AGVs' warning beeps, the doors, the pickups, the coolant, and the plant's hum in
 * the background. Starts on the first key or click (the browsers' rule).
 */
import type { ToolId } from './sim.js';

export type Sfx = ToolId | 'denied' | 'bump' | 'agv' | 'splash' | 'pickup' | 'key' | 'door-open' | 'door-close' | 'repair' | 'exit';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: AudioNode[] = [];
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.7;
  muted = false;

  /** Creates the audio context (call from a user gesture). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number, muted: boolean): void {
    this.volume = v;
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  /** The plant's low hum and its slow throb (while a level is played). */
  startHum(): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.hum.length > 0) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.35;
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(filter.frequency);
    const oscs = [55, 55.6, 82.5].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    lfo.start();
    filter.connect(gain).connect(master);
    this.hum = [...oscs, lfo, gain];
  }

  stopHum(): void {
    for (const n of this.hum) {
      if (n instanceof OscillatorNode) n.stop();
      n.disconnect();
    }
    this.hum = [];
  }

  dispose(): void {
    this.stopHum();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** A sound at a distance (m) from the technician: fainter further away. */
  play(s: Sfx, distance = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.muted) return;
    const v = Math.max(0.08, 1 / (1 + distance * 0.25));
    const t = ctx.currentTime;
    switch (s) {
      case 'wrench':
        // a ratchet: quick clicks
        for (let k = 0; k < 3; k++) this.noise(t + k * 0.06, 0.03, 2600, 'bandpass', 0.25);
        break;
      case 'multimeter':
        this.tone(t, 'square', 1800, 1800, 0.05, 0.08);
        break;
      case 'laptop':
        for (let k = 0; k < 3; k++) this.noise(t + k * 0.07 + Math.random() * 0.03, 0.02, 4000, 'highpass', 0.15);
        break;
      case 'denied':
        this.tone(t, 'square', 150, 150, 0.25, 0.18);
        break;
      case 'bump':
        this.tone(t, 'sine', 110, 50, 0.25, 0.5);
        this.noise(t, 0.15, 500, 'lowpass', 0.35);
        break;
      case 'agv':
        // the reversing beeper, fainter further away
        this.tone(t, 'square', 1250, 1250, 0.12, 0.1 * v);
        break;
      case 'splash':
        this.noise(t, 0.2, 900, 'bandpass', 0.18);
        break;
      case 'pickup':
        this.tone(t, 'triangle', 660, 660, 0.06, 0.2);
        this.tone(t + 0.07, 'triangle', 990, 990, 0.09, 0.2);
        break;
      case 'key':
        [523, 659, 784, 1046].forEach((f, k) => this.tone(t + k * 0.07, 'triangle', f, f, 0.1, 0.2));
        break;
      case 'door-open':
      case 'door-close':
        this.noise(t, 0.6, s === 'door-open' ? 500 : 350, 'lowpass', 0.25 * v);
        this.tone(t, 'sawtooth', 70, s === 'door-open' ? 90 : 55, 0.6, 0.08 * v);
        break;
      case 'repair':
        // the machine starts again: a motor spinning up, then a chime
        this.tone(t, 'sawtooth', 60, 240, 0.8, 0.12);
        [392, 523, 659, 784].forEach((f, k) => this.tone(t + 0.5 + k * 0.09, 'triangle', f, f, 0.14, 0.18));
        break;
      case 'exit':
        [262, 330, 392, 523, 659].forEach((f, k) => this.tone(t + k * 0.11, 'triangle', f, f, 0.16, 0.22));
        break;
    }
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(t: number, dur: number, freq: number, type: BiquadFilterType, vol: number): void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
