// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The sound of City Drive (#95), all made with WebAudio — no audio file:
 *
 * - per local player (panned left / right with two players): an **engine** (two detuned
 *   oscillators through a low-pass filter; pitch with the speed, growl with the throttle),
 *   the **tyre screech** of a slide (filtered noise, with the lateral slip), the **horn**;
 * - effects: a crash thud, the logo burst, the speed camera's shutter, a siren while chased;
 * - the **radio**: original stations played by a small step sequencer — *Neon FM*
 *   (synthwave), *Lo-Fi Plant* (slow chords, crackle) and *WinCC OA Talk* (the plant's news,
 *   read by the browser's speech synthesis) — or off.
 *
 * Browsers only let sound start after a user gesture: {@link GameAudio.unlock} is called on the
 * Start button / key. Volumes come from the settings (effects, music).
 */

export type StationId = 'off' | 'neon' | 'lofi' | 'talk';
export const STATIONS: readonly { id: StationId; label: string }[] = [
  { id: 'off', label: 'Radio off' },
  { id: 'neon', label: 'Neon FM · synthwave' },
  { id: 'lofi', label: 'Lo-Fi Plant · chill' },
  { id: 'talk', label: 'WinCC OA Talk · plant news' }
];

/** What one player's car sounds like at this frame. */
export interface VoiceInput {
  /** m/s (absolute). */
  speed: number;
  /** 0..1. */
  throttle: number;
  /** Lateral slip, m/s (a drift). */
  slip: number;
  horn: boolean;
  /** On foot: no engine. */
  onFoot: boolean;
}

export type Sfx = 'crash' | 'logo' | 'flash' | 'explosion' | 'throw';

/** Engine pitch (Hz) for a speed and a throttle: idle ~48 Hz, ~4 "gears" up to ~190 Hz. */
export function enginePitch(speed: number, throttle: number): number {
  const gearSpan = 13; // m/s per gear
  const inGear = (speed % gearSpan) / gearSpan;
  const gear = Math.min(4, Math.floor(speed / gearSpan));
  return 48 + gear * 22 + inGear * 70 + throttle * 14;
}

/** Screech level 0..1 for a lateral slip (m/s): silent under 2.5 m/s. */
export const screechLevel = (slip: number): number => Math.max(0, Math.min(1, (slip - 2.5) / 6));

interface Voice {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  filter: BiquadFilterNode;
  engineGain: GainNode;
  screechGain: GainNode;
  hornGain: GainNode;
  pan: StereoPannerNode;
}

// A minor – F – C – G, as MIDI roots, for the music stations
const CHORDS = [57, 53, 48, 55];
const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export class GameAudio {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices: Voice[] = [];
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;
  private station: StationId = 'off';
  private nextNote = 0;
  private step = 0;
  private timer = 0;
  private sfxVolume = 0.6;
  private musicVolume = 0.4;
  /** The talk station's next news (the page feeds it). */
  news: () => string = () => '';
  private lastNewsAt = 0;

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  get stationId(): StationId {
    return this.station;
  }

  /** Creates the audio graph (after a user gesture). */
  unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') {
      void this.ctx?.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(ctx.destination);
    this.musicBus.connect(ctx.destination);
    this.setVolumes(this.sfxVolume, this.musicVolume);
    // one second of white noise, reused by the screech, the drums and the crackle
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.sfxBus?.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.musicBus?.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }

  /** The cars of `n` local players (panned when two). */
  setPlayers(n: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    while (this.voices.length > n) {
      const v = this.voices.pop() as Voice;
      v.oscA.stop();
      v.oscB.stop();
      v.pan.disconnect();
    }
    while (this.voices.length < n) {
      const pan = ctx.createStereoPanner();
      pan.connect(this.sfxBus);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      const engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const oscA = ctx.createOscillator();
      oscA.type = 'sawtooth';
      const oscB = ctx.createOscillator();
      oscB.type = 'square';
      oscB.detune.value = -1200 + 7; // an octave down, slightly off: the rumble
      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(engineGain).connect(pan);
      oscA.start();
      oscB.start();
      const screech = ctx.createBufferSource();
      screech.buffer = this.noise;
      screech.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2600;
      band.Q.value = 6;
      const screechGain = ctx.createGain();
      screechGain.gain.value = 0;
      screech.connect(band).connect(screechGain).connect(pan);
      screech.start();
      const hornGain = ctx.createGain();
      hornGain.gain.value = 0;
      for (const f of [392, 494]) {
        const h = ctx.createOscillator();
        h.type = 'square';
        h.frequency.value = f;
        h.connect(hornGain);
        h.start();
      }
      const hornFilter = ctx.createBiquadFilter();
      hornFilter.type = 'lowpass';
      hornFilter.frequency.value = 1800;
      hornGain.connect(hornFilter).connect(pan);
      this.voices.push({ oscA, oscB, filter, engineGain, screechGain, hornGain, pan });
    }
    this.voices.forEach((v, k) => (v.pan.pan.value = n > 1 ? (k === 0 ? -0.7 : 0.7) : 0));
  }

  /** Each frame: the engine, the screech and the horn of player i. */
  voice(i: number, input: VoiceInput): void {
    const ctx = this.ctx;
    const v = this.voices[i];
    if (!ctx || !v) return;
    const t = ctx.currentTime;
    const f = enginePitch(input.speed, input.throttle);
    v.oscA.frequency.setTargetAtTime(f, t, 0.05);
    v.oscB.frequency.setTargetAtTime(f, t, 0.05);
    v.filter.frequency.setTargetAtTime(400 + input.throttle * 1400 + input.speed * 12, t, 0.08);
    v.engineGain.gain.setTargetAtTime(input.onFoot ? 0 : 0.05 + 0.07 * input.throttle, t, 0.08);
    v.screechGain.gain.setTargetAtTime(input.onFoot ? 0 : 0.18 * screechLevel(input.slip), t, 0.05);
    v.hornGain.gain.setTargetAtTime(input.horn ? 0.09 : 0, t, 0.015);
  }

  /** A one-shot effect. */
  play(kind: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.connect(this.sfxBus);
    if (kind === 'crash' || kind === 'explosion') {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(kind === 'crash' ? 900 : 1600, t);
      lp.frequency.exponentialRampToValueAtTime(80, t + 0.6);
      g.gain.setValueAtTime(kind === 'crash' ? 0.5 : 0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      n.connect(lp).connect(g);
      n.start(t);
      n.stop(t + 0.8);
    } else if (kind === 'throw') {
      // a whoosh: band-passed noise sweeping down
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(2400, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      n.connect(bp).connect(g);
      n.start(t);
      n.stop(t + 0.3);
    } else if (kind === 'logo') {
      // a bright two-note chime
      [988, 1319].forEach((f, k) => {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t + k * 0.07);
        og.gain.exponentialRampToValueAtTime(0.2, t + k * 0.07 + 0.01);
        og.gain.exponentialRampToValueAtTime(0.0001, t + k * 0.07 + 0.3);
        o.connect(og).connect(g);
        o.start(t + k * 0.07);
        o.stop(t + k * 0.07 + 0.32);
      });
      g.gain.value = 1;
    } else {
      // the camera's shutter: a short click of noise
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      n.connect(hp).connect(g);
      n.start(t);
      n.stop(t + 0.1);
    }
  }

  /** The two-tone siren while security cars give chase. */
  setSiren(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    if (on && !this.siren) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0.035;
      // 960 / 770 Hz alternating twice a second
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1;
      const depth = ctx.createGain();
      depth.gain.value = 95;
      osc.frequency.value = 865;
      lfo.connect(depth).connect(osc.frequency);
      osc.connect(gain).connect(this.sfxBus);
      osc.start();
      lfo.start();
      this.siren = { osc, gain };
    } else if (!on && this.siren) {
      this.siren.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      const s = this.siren;
      window.setTimeout(() => s.osc.stop(), 400);
      this.siren = null;
    }
  }

  /** The next station (wraps); returns its label. */
  nextStation(): string {
    const i = STATIONS.findIndex((s) => s.id === this.station);
    return this.setStation(STATIONS[(i + 1) % STATIONS.length].id);
  }

  setStation(id: StationId): string {
    this.station = id;
    this.step = 0;
    if (this.ctx) this.nextNote = this.ctx.currentTime + 0.1;
    if (id !== 'talk') globalThis.speechSynthesis?.cancel();
    if (id === 'talk') this.lastNewsAt = 0;
    return STATIONS.find((s) => s.id === id)?.label ?? '';
  }

  dispose(): void {
    window.clearInterval(this.timer);
    globalThis.speechSynthesis?.cancel();
    void this.ctx?.close();
    this.ctx = null;
    this.voices.length = 0;
    this.siren = null;
  }

  // --- the radio's sequencer -----------------------------------------------------------------

  /** Schedules the notes of the next ~0.2 s (look-ahead), or the next news on the talk station. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || this.station === 'off') return;
    if (this.station === 'talk') {
      this.talk();
      return;
    }
    const bpm = this.station === 'neon' ? 104 : 76;
    const sixteenth = 60 / bpm / 4;
    while (this.nextNote < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextNote, sixteenth);
      this.nextNote += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, len: number): void {
    const chord = CHORDS[Math.floor(step / 16) % 4];
    const beat = step % 4 === 0;
    if (this.station === 'neon') {
      // bass on every eighth, an arpeggio on the sixteenths, kick / snare / hat
      if (step % 2 === 0) this.tone(midiHz(chord - 12), t, len * 1.8, 'sawtooth', 0.16, 700);
      const arp = [0, 3, 7, 12, 7, 3, 0, 7][step % 8];
      this.tone(midiHz(chord + 12 + arp), t, len * 0.9, 'square', 0.05, 2600);
      if (step % 8 === 0) this.kick(t, 0.5);
      if (step % 8 === 4) this.snare(t, 0.22);
      if (step % 2 === 1) this.hat(t, 0.05);
    } else {
      // slow chords on the beat, a soft kick, vinyl crackle
      if (step % 16 === 0) for (const iv of [0, 3, 7, 10]) this.tone(midiHz(chord + iv), t, len * 15, 'sine', 0.05, 1800);
      if (step % 16 === 8) this.tone(midiHz(chord + 15), t, len * 6, 'triangle', 0.035, 2000);
      if (step % 8 === 0) this.kick(t, 0.3);
      if (step % 8 === 4) this.snare(t, 0.08);
      if (beat && Math.random() < 0.5) this.hat(t + len * 0.5, 0.015);
    }
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.musicBus as GainNode);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.musicBus as GainNode);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx as AudioContext;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.musicBus as GainNode);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.02);
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.18, 'bandpass', 1800);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.04, 'highpass', 7000);
  }

  /** The talk station: a news item every ~12 s, read by the browser's speech synthesis. */
  private talk(): void {
    const synth = globalThis.speechSynthesis;
    if (!synth || synth.speaking || Date.now() - this.lastNewsAt < 12_000) return;
    const text = this.news();
    if (!text) return;
    this.lastNewsAt = Date.now();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.05;
    u.volume = Math.min(1, this.musicVolume * 2);
    synth.speak(u);
  }
}
