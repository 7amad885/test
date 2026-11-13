// Procedural WebAudio sound design: every sound is synthesised at runtime
// (no third-party samples), with a generated convolution reverb and HRTF
// panning for remote gunfire.

import { useUI } from "./store";

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private ambience: { stop: () => void } | null = null;
  private captureOsc: { osc: OscillatorNode; gain: GainNode } | null = null;

  /** Must be called from a user gesture (tap/click) for iOS Safari. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: "interactive" });
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      this.master = ctx.createGain();
      this.master.gain.value = useUI.getState().settings.volume;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.2, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.32;
      this.reverbSend.connect(this.reverb).connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      useUI.subscribe((s) => {
        if (this.master) this.master.gain.value = s.settings.volume;
      });
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections + diffuse metallic tail
        const early = i < ctx.sampleRate * 0.06 && Math.random() < 0.004 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early * (Math.random() * 2 - 1)) * 0.6;
      }
    }
    return buf;
  }

  private get ok() {
    return !!this.ctx && this.ctx.state === "running";
  }

  private noiseSrc(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Output node: either direct or spatialised at a world position. */
  private out(pos?: { x: number; y: number; z: number }, wet = 0.3): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = 4;
      p.maxDistance = 120;
      p.rolloffFactor = 1.1;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = wet;
    g.connect(send).connect(this.reverbSend);
    return g;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    if (!this.ok) return;
    const l = this.ctx!.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  gunshot(pos?: { x: number; y: number; z: number }, opts: { echo?: boolean; volume?: number } = {}) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const vol = opts.volume ?? 1;
    const out = this.out(pos, pos ? 0.45 : 0.3);
    // 1) crack: bright filtered noise
    const n = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = "peaking";
    bp.frequency.value = 2600;
    bp.gain.value = 8;
    const g1 = ctx.createGain();
    this.env(g1, t, 0.9 * vol, 0.001, 0.09);
    n.connect(hp).connect(bp).connect(g1).connect(out);
    n.start(t);
    n.stop(t + 0.14);
    // 2) body thump
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(opts.echo ? 210 : 150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.85 * vol, 0.002, 0.14);
    o.connect(g2).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    // 3) low-passed tail
    const n2 = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const g3 = ctx.createGain();
    this.env(g3, t, 0.35 * vol, 0.004, 0.42);
    n2.connect(lp).connect(g3).connect(out);
    n2.start(t);
    n2.stop(t + 0.5);
    // 4) energy "zap" signature of the pulse rifle (stronger, detuned for echoes)
    const z = ctx.createOscillator();
    z.type = "sawtooth";
    z.frequency.setValueAtTime(opts.echo ? 1700 : 1300, t);
    z.frequency.exponentialRampToValueAtTime(opts.echo ? 260 : 180, t + 0.08);
    const zf = ctx.createBiquadFilter();
    zf.type = "bandpass";
    zf.frequency.value = 1500;
    zf.Q.value = 2;
    const g4 = ctx.createGain();
    this.env(g4, t, (opts.echo ? 0.22 : 0.12) * vol, 0.001, 0.08);
    z.connect(zf).connect(g4).connect(out);
    z.start(t);
    z.stop(t + 0.12);
    if (!pos) this.click(t + 0.03, 4200, 0.08);
  }

  private click(t: number, freq: number, vol: number, pos?: { x: number; y: number; z: number }) {
    const ctx = this.ctx!;
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 6;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.001, 0.035);
    n.connect(bp).connect(g).connect(this.out(pos, 0.1));
    n.start(t);
    n.stop(t + 0.06);
  }

  reload() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.click(t + 0.32, 1800, 0.35); // mag release
    this.click(t + 0.42, 900, 0.25); // mag drop
    this.click(t + 1.25, 2400, 0.4); // mag seat
    this.click(t + 1.32, 1200, 0.3);
    this.click(t + 1.7, 3200, 0.35); // charging handle back
    this.click(t + 1.82, 2600, 0.45); // forward
  }

  dryFire() {
    if (this.ok) this.click(this.ctx!.currentTime, 3000, 0.3);
  }

  footstep(pos?: { x: number; y: number; z: number }, vol = 0.18) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700 + Math.random() * 300;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, 0.07);
    n.connect(lp).connect(g).connect(this.out(pos, 0.05));
    n.start(t);
    n.stop(t + 0.1);
    this.click(t + 0.01, 3500 + Math.random() * 1500, vol * 0.25, pos);
  }

  hitmarker(head: boolean) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = head ? "triangle" : "square";
    o.frequency.value = head ? 1900 : 1250;
    const g = ctx.createGain();
    this.env(g, t, head ? 0.22 : 0.1, 0.001, head ? 0.16 : 0.05);
    o.connect(g).connect(this.out(undefined, 0.05));
    o.start(t);
    o.stop(t + 0.2);
  }

  kill() {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t + i * 0.07, 0.16, 0.002, 0.22);
      o.connect(g).connect(this.out(undefined, 0.2));
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.3);
    });
  }

  hurt() {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.7, 0.003, 0.22);
    o.connect(g).connect(this.out(undefined, 0.1));
    o.start(t);
    o.stop(t + 0.3);
    const n = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g2 = ctx.createGain();
    this.env(g2, t, 0.4, 0.002, 0.12);
    n.connect(lp).connect(g2).connect(this.out(undefined, 0));
    n.start(t);
    n.stop(t + 0.15);
  }

  rewind(duration = 3.2) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const out = this.out(undefined, 0.7);
    for (const det of [-14, 0, 9]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.detune.value = det;
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(900, t + duration * 0.55);
      o.frequency.exponentialRampToValueAtTime(55, t + duration);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(5000, t + duration * 0.5);
      lp.frequency.exponentialRampToValueAtTime(200, t + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.4);
      g.gain.setValueAtTime(0.09, t + duration - 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + duration + 0.05);
    }
    // reversed-swell noise
    const n = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + duration);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + duration * 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.08);
    n.connect(bp).connect(g).connect(out);
    n.start(t);
    n.stop(t + duration + 0.1);
    // ticking clock hand running backwards
    for (let i = 0; i < 14; i++) this.click(t + i * (duration / 14) * (1 - i / 40), 5200 - i * 120, 0.12);
  }

  paradox(good: boolean) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    car.type = "sine";
    car.frequency.value = good ? 520 : 180;
    mod.frequency.value = good ? 7 : 31;
    modG.gain.value = good ? 120 : 260;
    mod.connect(modG).connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.25, 0.01, 0.9);
    car.connect(g).connect(this.out(undefined, 0.8));
    car.start(t);
    mod.start(t);
    car.stop(t + 1);
    mod.stop(t + 1);
  }

  announce() {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    [392, 523, 659].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      this.env(g, t + i * 0.09, 0.09, 0.01, 0.5);
      o.connect(g).connect(this.out(undefined, 0.5));
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.6);
    });
  }

  ui() {
    if (this.ok) this.click(this.ctx!.currentTime, 2400, 0.15);
  }

  /** Continuous capture hum; pitch shows who is capturing. */
  setCapture(state: number, mySide: number) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    if (!this.captureOsc) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      osc.connect(lp).connect(gain).connect(this.sfx);
      osc.start();
      this.captureOsc = { osc, gain };
    }
    const { osc, gain } = this.captureOsc;
    const t = ctx.currentTime;
    const on = state === 0 || state === 1;
    gain.gain.setTargetAtTime(on ? 0.05 : state === 2 ? 0.03 : 0, t, 0.15);
    osc.frequency.setTargetAtTime(state === 2 ? 140 : state === mySide ? 330 : 196, t, 0.1);
  }

  startAmbience() {
    if (!this.ok || this.ambience) return;
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 3);
    g.connect(this.master);
    const oscs = [55, 82.4, 110.3].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? "triangle" : "sine";
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 10;
      o.connect(g);
      o.start();
      return o;
    });
    const n = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(lp).connect(ng).connect(g);
    n.start();
    this.ambience = {
      stop: () => {
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
        setTimeout(() => {
          oscs.forEach((o) => o.stop());
          n.stop();
        }, 1500);
      },
    };
  }

  stopAmbience() {
    this.ambience?.stop();
    this.ambience = null;
    this.setCapture(-1, 0);
  }
}

export const audio = new AudioEngine();
