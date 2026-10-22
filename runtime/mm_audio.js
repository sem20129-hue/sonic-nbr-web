/* mm_audio.js — MiniMaker runtime audio (Web Audio API).
 * Purpose: synthesized SFX + chiptune/horror music, zero assets, zero dependencies.
 * Classic script: attaches to globalThis.MM (reuses it, never replaces it).
 * Headless-safe (Node / no AudioContext): every call is a no-op, isReady() === false.
 */
(function (root) {
  'use strict';

  var MM = (root.MM && typeof root.MM === 'object') ? root.MM : (root.MM = {});
  MM.sounds = MM.sounds || {};
  MM.musics = MM.musics || {};

  var AudioCtor = (typeof root.AudioContext === 'function') ? root.AudioContext
                : (typeof root.webkitAudioContext === 'function') ? root.webkitAudioContext
                : null;

  var MASTER_VOL = 0.7;   // default master gain (safety ceiling for everything)
  var TICK_MS = 25;       // music scheduler interval
  var LOOKAHEAD = 0.12;   // how far ahead the scheduler looks (>= 100 ms)
  var FADE_IN = 0.5;      // music fade-in, creepy
  var NOTE_RE = /^([a-g])([#b]?)(\d)$/;
  var SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var WAVE_MAP = { sine: 'sine', square: 'square', triangle: 'triangle', saw: 'sawtooth', sawtooth: 'sawtooth' };

  /* ------------------------------ helpers ------------------------------ */

  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  function num(v, dflt) {
    v = Number(v);
    return isFinite(v) ? v : dflt;
  }

  function waveOf(w) {
    var key = String(w === undefined || w === null ? '' : w).toLowerCase();
    return WAVE_MAP[key] || 'square';
  }

  // 'c4', 'd#4', 'ab3'... -> Hz (0 when unparsable)
  function noteFreq(name) {
    var s = String(name === undefined || name === null ? '' : name).toLowerCase().trim();
    var m = NOTE_RE.exec(s);
    if (!m) return 0;
    var semi = SEMI[m[1]] + (m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0));
    var midi = (parseInt(m[3], 10) + 1) * 12 + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Attack -> hold -> release envelope on an AudioParam. Returns the end time.
  function env(param, t0, vol, attack, holdUntil, release) {
    var a = Math.max(0.002, num(attack, 0.005));
    var r = Math.max(0.004, num(release, 0.05));
    var aEnd = t0 + a;
    var hEnd = Math.max(aEnd, holdUntil);
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(vol, aEnd);
    param.setValueAtTime(vol, hEnd);
    param.linearRampToValueAtTime(0, hEnd + r);
    return hEnd + r;
  }

  /* ---------------------------- graph state ---------------------------- */

  var ctx = null, master = null, sfxBus = null, musicVol = null, musicFade = null;
  var sfxVolume = 1, musicVolume = 0.8;
  var noiseBuf = null;
  var liveSfx = {}; // name -> [{ s: source, e: endTime }]
  var music = {     // current music session
    name: null, def: null, gen: 0, timer: null,
    step: 0, nextTime: 0, srcs: [], active: false
  };

  function isReady() { return !!(ctx && master); }

  function resumeCtx() {
    try {
      if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') {
        var p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  function init() {
    if (isReady()) { resumeCtx(); return true; }
    if (!AudioCtor) return false; // headless: stay a no-op
    try {
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = MASTER_VOL;
      master.connect(ctx.destination);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVolume;
      sfxBus.connect(master);

      musicFade = ctx.createGain();
      musicFade.gain.value = 1;
      musicVol = ctx.createGain();
      musicVol.gain.value = musicVolume;
      musicVol.connect(musicFade);
      musicFade.connect(master);

      resumeCtx(); // mobile: context often starts suspended
      return true;
    } catch (e) {
      ctx = null; master = null; sfxBus = null; musicVol = null; musicFade = null;
      return false;
    }
  }

  function getNoiseBuffer() {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function stopList(list) {
    for (var i = 0; i < list.length; i++) {
      try { list[i].s.stop(0); } catch (e) { /* already stopped */ }
    }
    list.length = 0;
  }

  /* ------------------------------ voices ------------------------------- */

  // kind:'osc' — one oscillator, pitch slide + envelope.
  function playOsc(def, dest, t0) {
    var dur = Math.max(0.01, num(def.dur, 0.2));
    var f0 = Math.max(0.001, num(def.f0, 440));
    var f1 = Math.max(0.001, num(def.f1, f0));
    var o = ctx.createOscillator();
    o.type = waveOf(def.wave);
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) {
      if (def.curve === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      else o.frequency.linearRampToValueAtTime(f1, t0 + dur);
    }
    var g = ctx.createGain();
    var end = env(g.gain, t0, clamp01(def.vol), def.attack, t0 + dur, def.release);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(end + 0.02);
    return [{ s: o, e: end + 0.02 }];
  }

  // kind:'noise' — white noise burst through a lowpass with sliding cutoff.
  function playNoise(def, dest, t0) {
    var dur = Math.max(0.01, num(def.dur, 0.2));
    var ff = Math.max(10, num(def.filterFrom, 1200));
    var ft = Math.max(10, num(def.filterTo, ff));
    var src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = Math.max(0, num(def.q, 1));
    lp.frequency.setValueAtTime(ff, t0);
    if (ft !== ff) lp.frequency.exponentialRampToValueAtTime(ft, t0 + dur);
    var g = ctx.createGain();
    var end = env(g.gain, t0, clamp01(def.vol), def.attack, t0 + dur, def.release);
    src.connect(lp); lp.connect(g); g.connect(dest);
    src.start(t0); src.stop(end + 0.02);
    return [{ s: src, e: end + 0.02 }];
  }

  // kind:'seq' — arpeggio of short oscillator notes (coin/jump blips).
  function playSeq(def, dest, t0) {
    var out = [];
    var vol = clamp01(def.vol);
    var notes = def.notes || [];
    var t = t0;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i] || {};
      var d = Math.max(0.02, num(n.d, 0.09));
      var f = num(n.f, 0);
      if (f > 0) {
        var o = ctx.createOscillator();
        o.type = waveOf(n.wave);
        o.frequency.setValueAtTime(f, t);
        var g = ctx.createGain();
        var p = g.gain, a = 0.008, r = 0.008; // 8 ms attack/release: no clicks
        p.setValueAtTime(0, t);
        p.linearRampToValueAtTime(vol, t + a);
        p.setValueAtTime(vol, Math.max(t + a, t + d - r));
        p.linearRampToValueAtTime(0, t + d);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + d + 0.02);
        out.push({ s: o, e: t + d + 0.02 });
      }
      t += d;
    }
    return out;
  }

  // kind:'scream' — horror hybrid: bandpassed noise sweep + detuned saw glide,
  // glued by a soft waveshaper. Bounded by the envelope and master gain.
  function playScream(def, dest, t0) {
    var dur = Math.max(0.1, num(def.dur, 1.2));
    var from = Math.max(40, num(def.from, 900));
    var to = Math.max(40, num(def.to, 140));
    var vol = clamp01(def.vol);
    var out = [];

    var shaper = ctx.createWaveShaper();
    var n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';

    var g = ctx.createGain();
    var end = env(g.gain, t0, vol, 0.02, t0 + dur, 0.25);
    shaper.connect(g); g.connect(dest);

    var ns = ctx.createBufferSource(); // breath
    ns.buffer = getNoiseBuffer();
    ns.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 8;
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.exponentialRampToValueAtTime(to, t0 + dur * 0.6); // fast downward sweep
    var ng = ctx.createGain();
    ng.gain.value = 0.9;
    ns.connect(bp); bp.connect(ng); ng.connect(shaper);
    ns.start(t0); ns.stop(end + 0.05);
    out.push({ s: ns, e: end + 0.05 });

    var sg = ctx.createGain(); // the voice: two detuned saws gliding down
    sg.gain.value = 0.5;
    sg.connect(shaper);
    for (var k = 0; k < 2; k++) {
      var sw = ctx.createOscillator();
      sw.type = 'sawtooth';
      sw.detune.value = k ? 30 : -30;
      sw.frequency.setValueAtTime(from * 0.6, t0);
      sw.frequency.exponentialRampToValueAtTime(to * 0.6, t0 + dur * 0.9);
      sw.connect(sg);
      sw.start(t0); sw.stop(end + 0.05);
      out.push({ s: sw, e: end + 0.05 });
    }
    return out;
  }

  /* ----------------------------- definitions ---------------------------- */

  MM.defineSound = function (def) {
    if (!def || typeof def.name !== 'string' || def.name === '') return null;
    var kind = (def.kind === 'noise' || def.kind === 'seq' || def.kind === 'scream') ? def.kind : 'osc';
    var s = {
      name: def.name,
      kind: kind,
      wave: waveOf(def.wave),
      f0: num(def.f0, 440),
      f1: num(def.f1, num(def.f0, 440)),
      dur: Math.max(0.01, num(def.dur, kind === 'scream' ? 1.2 : 0.2)),
      vol: clamp01(def.vol === undefined ? 0.7 : def.vol),
      attack: Math.max(0, num(def.attack, 0.005)),
      release: Math.max(0.002, num(def.release, 0.05)),
      curve: def.curve === 'exp' ? 'exp' : 'lin',
      filterFrom: num(def.filterFrom, 1200),
      filterTo: num(def.filterTo, num(def.filterFrom, 1200)),
      q: Math.max(0, num(def.q, 1)),
      from: num(def.from, 900),
      to: num(def.to, 140),
      notes: []
    };
    if (kind === 'seq') {
      var notes = Array.isArray(def.notes) ? def.notes : [];
      for (var i = 0; i < notes.length; i++) {
        var n = notes[i] || {};
        var f = num(n.f, 0);
        if (!(f > 0) && typeof n.note === 'string') f = noteFreq(n.note);
        s.notes.push({ wave: waveOf(n.wave), f: Math.max(0, f), d: Math.max(0.02, num(n.d, 0.09)) });
      }
    }
    MM.sounds[def.name] = s;
    return s;
  };

  MM.defineMusic = function (def) {
    if (!def || typeof def.name !== 'string' || def.name === '') return null;
    var d = {
      name: def.name,
      bpm: Math.min(999, Math.max(20, num(def.bpm, 120))),
      loop: def.loop !== false,
      tracks: Array.isArray(def.tracks) ? def.tracks : []
    };
    MM.musics[def.name] = d;
    return d;
  };

  /* -------------------------------- sfx -------------------------------- */

  function pruneActive() {
    var now = ctx.currentTime;
    for (var k in liveSfx) {
      if (!Object.prototype.hasOwnProperty.call(liveSfx, k)) continue;
      var list = liveSfx[k], keep = [];
      for (var i = 0; i < list.length; i++) if (list[i].e > now) keep.push(list[i]);
      if (keep.length) liveSfx[k] = keep; else delete liveSfx[k];
    }
  }

  function sfx(name) {
    if (!isReady()) return;
    var def = MM.sounds[name];
    if (!def) return; // unknown sound: ignore
    resumeCtx();
    pruneActive();
    var prev = liveSfx[name];
    if (prev) { stopList(prev); delete liveSfx[name]; } // replace same sound
    try {
      var t0 = ctx.currentTime + 0.01;
      var items;
      if (def.kind === 'noise') items = playNoise(def, sfxBus, t0);
      else if (def.kind === 'seq') items = playSeq(def, sfxBus, t0);
      else if (def.kind === 'scream') items = playScream(def, sfxBus, t0);
      else items = playOsc(def, sfxBus, t0);
      if (items.length) liveSfx[name] = items;
    } catch (e) { /* never break the game loop because of audio */ }
  }

  function stopAllSfx() {
    for (var k in liveSfx) {
      if (Object.prototype.hasOwnProperty.call(liveSfx, k)) stopList(liveSfx[k]);
    }
    liveSfx = {};
    // sfx uses no timers, so nothing else to cancel here
  }

  /* ------------------------------- music ------------------------------- */

  function musicLen(def) {
    var n = 0;
    for (var i = 0; i < def.tracks.length; i++) {
      var tr = def.tracks[i];
      if (tr && Array.isArray(tr.notes) && tr.notes.length > n) n = tr.notes.length;
    }
    return n;
  }

  function scheduleStep(def, idx, t) {
    var stepDur = 60 / def.bpm / 4; // 16th notes
    for (var i = 0; i < def.tracks.length; i++) {
      var tr = def.tracks[i];
      if (!tr || !Array.isArray(tr.notes) || idx >= tr.notes.length) continue; // short track: rest
      var tok = tr.notes[idx];
      if (tok === undefined || tok === null || tok === '' || tok === '-' || tok === '.') continue;
      var amp = clamp01(num(tr.vol, 0.5)) * 0.8;
      try {
        if (tr.drum) {
          var tk = String(tok).trim();
          var drum = null;
          if (tk === 'x') drum = { type: 'lowpass', from: 1400, to: 70, q: 2.5, dur: 0.14, amp: amp, hold: 0.02 };
          else if (tk === 'o') drum = { type: 'highpass', from: 6500, to: 6500, q: 0.7, dur: 0.16, amp: amp * 0.45, hold: 0.01 };
          else if (tk === 'X') drum = { type: 'lowpass', from: 900, to: 45, q: 5, dur: 0.24, amp: Math.min(1, amp * 1.25), hold: 0.03 };
          if (!drum) continue; // '-' / '.' / anything else = rest
          var dsrc = ctx.createBufferSource();
          dsrc.buffer = getNoiseBuffer();
          dsrc.loop = true;
          var df = ctx.createBiquadFilter();
          df.type = drum.type;
          df.Q.value = drum.q;
          df.frequency.setValueAtTime(drum.from, t);
          if (drum.to !== drum.from) df.frequency.exponentialRampToValueAtTime(drum.to, t + drum.dur);
          var dg = ctx.createGain();
          dg.gain.setValueAtTime(0, t);
          dg.gain.linearRampToValueAtTime(drum.amp, t + 0.002);
          dg.gain.setValueAtTime(drum.amp, t + drum.hold);
          dg.gain.linearRampToValueAtTime(0, t + drum.dur);
          dsrc.connect(df); df.connect(dg); dg.connect(musicVol);
          var dend = t + drum.dur + 0.02;
          dsrc.start(t); dsrc.stop(dend);
          music.srcs.push({ s: dsrc, e: dend });
        } else {
          var f = noteFreq(tok);
          if (!(f > 0)) continue;
          var gate = num(tr.gate, 0.8);
          var nd = Math.max(0.03, stepDur * gate);
          var o = ctx.createOscillator();
          o.type = waveOf(tr.wave);
          o.frequency.setValueAtTime(f, t);
          var g = ctx.createGain();
          var p = g.gain, a = 0.008, r = Math.min(0.05, Math.max(0.015, nd * 0.3));
          p.setValueAtTime(0, t);
          p.linearRampToValueAtTime(amp, t + a);
          p.setValueAtTime(amp, Math.max(t + a, t + nd - r));
          p.linearRampToValueAtTime(0, t + nd);
          o.connect(g); g.connect(musicVol);
          var end = t + nd + 0.02;
          o.start(t); o.stop(end);
          music.srcs.push({ s: o, e: end });
        }
      } catch (e) { /* skip this note, keep the song alive */ }
    }
  }

  function pruneSrcs() {
    var cutoff = ctx.currentTime - 0.5, keep = [];
    for (var i = 0; i < music.srcs.length; i++) {
      if (music.srcs[i].e > cutoff) keep.push(music.srcs[i]);
    }
    music.srcs = keep;
  }

  function tick(gen) {
    if (!isReady() || gen !== music.gen || !music.active || !music.def) return;
    var def = music.def;
    var len = musicLen(def);
    if (len <= 0) { stopMusic(); return; }
    var stepDur = 60 / def.bpm / 4;
    var horizon = ctx.currentTime + LOOKAHEAD;
    var guard = 0;
    while (music.nextTime < horizon && guard < 512) {
      guard++;
      var s = music.step;
      var idx = s;
      if (s >= len) {
        if (!def.loop) { // song over: never leave the interval running
          if (music.timer) { clearInterval(music.timer); music.timer = null; }
          music.active = false;
          return;
        }
        idx = s % len; // loop: keep stepping forever, wrap the pattern
      }
      scheduleStep(def, idx, music.nextTime);
      music.step = s + 1;
      music.nextTime += stepDur;
    }
    pruneSrcs();
  }

  function stopMusic() {
    music.gen++; // invalidates any stale scheduler tick
    music.active = false;
    if (music.timer) { clearInterval(music.timer); music.timer = null; }
    music.name = null;
    music.def = null;
    music.step = 0;
    if (ctx && musicFade) {
      try {
        var now = ctx.currentTime;
        musicFade.gain.cancelScheduledValues(now);
        musicFade.gain.setValueAtTime(musicFade.gain.value, now);
        musicFade.gain.linearRampToValueAtTime(0, now + 0.06);
      } catch (e) { /* ignore */ }
      var when = ctx.currentTime + 0.08;
      for (var i = 0; i < music.srcs.length; i++) {
        try { music.srcs[i].s.stop(when); } catch (e) { /* ignore */ }
      }
    }
    music.srcs = [];
  }

  function musicPlay(name) {
    if (!isReady()) return false;
    var def = MM.musics[name];
    if (!def) return false;
    if (music.active && music.name === name) return true; // already playing: don't restart
    stopMusic(); // stops current music + cancels its pending notes
    resumeCtx();
    music.gen++;
    var gen = music.gen;
    music.name = name;
    music.def = def;
    music.active = true;
    music.step = 0;
    music.nextTime = ctx.currentTime + 0.06;
    try {
      var now = ctx.currentTime;
      musicFade.gain.cancelScheduledValues(now);
      musicFade.gain.setValueAtTime(0, now);
      musicFade.gain.linearRampToValueAtTime(1, now + FADE_IN);
    } catch (e) { /* ignore */ }
    tick(gen);
    music.timer = setInterval(function () {
      try { tick(gen); }
      catch (e) { stopMusic(); }
    }, TICK_MS);
    return true;
  }

  /* --------------------------- file-backed audio ------------------------ */

  // The ported game ships real .ogg / .wav files, so the runtime needs an
  // actual sample player next to the synthesizer.
  var fileBuffers = {};   // url -> AudioBuffer
  var fileLoading = {};   // url -> true
  var liveFiles = {};     // name -> [{ s: node }]
  var fileMusic = { name: null, src: null, node: null, gain: null, wantLoop: true };

  function loadFileBuffer(url) {
    if (!url) return null;
    if (fileBuffers[url]) return fileBuffers[url];
    if (fileLoading[url]) return null;
    fileLoading[url] = true;
    try {
      fetch(url).then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) { return ctx.decodeAudioData(ab); })
        .then(function (buf) {
          fileBuffers[url] = buf;
          fileLoading[url] = false;
          if (fileMusic.src === url && fileMusic.name && !fileMusic.node) startFileMusic();
        })
        .catch(function () { fileLoading[url] = false; });
    } catch (e) { fileLoading[url] = false; }
    return null;
  }

  function stopFile(name) {
    var list = liveFiles[name];
    if (!list) return;
    for (var i = 0; i < list.length; i++) { try { list[i].s.stop(0); } catch (e) {} }
    delete liveFiles[name];
  }

  function stopAllFiles() {
    for (var k in liveFiles) stopFile(k);
  }

  function playFile(name, src, opts) {
    if (!src) return false;
    opts = opts || {};
    if (!isReady()) return false;
    resumeCtx();
    var buf = fileBuffers[src];
    if (!buf) { loadFileBuffer(src); return false; }
    stopFile(name);
    try {
      var node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = !!opts.loop;
      if (opts.pitch && node.playbackRate) node.playbackRate.value = Math.max(0.01, opts.pitch);
      var g = ctx.createGain();
      g.gain.value = clamp01(opts.volume === undefined ? 1 : opts.volume);
      node.connect(g);
      g.connect(opts.music ? musicVol : sfxBus);
      node.start(0);
      liveFiles[name] = [{ s: node }];
      return true;
    } catch (e) { return false; }
  }

  function setFileVolume(name, v) {
    // volume is baked into the gain node; emulate with a per-name gain map
    var g = fileGains[name];
    if (g) { try { g.gain.setTargetAtTime(clamp01(v), ctx.currentTime, 0.02); } catch (e) {} }
  }

  var fileGains = {};

  function stopFileMusic() {
    if (fileMusic.node) { try { fileMusic.node.stop(0); } catch (e) {} }
    if (fileMusic.gain) { try { fileMusic.gain.disconnect(); } catch (e) {} }
    fileMusic.node = null; fileMusic.gain = null;
    fileMusic.name = null; fileMusic.src = null;
  }

  function startFileMusic() {
    var buf = fileBuffers[fileMusic.src];
    if (!buf || !isReady()) return false;
    try {
      var node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = fileMusic.wantLoop !== false;
      var g = ctx.createGain();
      g.gain.value = 0;
      node.connect(g);
      g.connect(musicVol);
      node.start(0);
      var now = ctx.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + 0.4);
      fileMusic.node = node;
      fileMusic.gain = g;
      return true;
    } catch (e) { return false; }
  }

  function playMusicFile(name, src, opts) {
    opts = opts || {};
    if (fileMusic.name === name && fileMusic.node) return true;
    stopFileMusic();
    if (!src) return false;
    fileMusic.name = name;
    fileMusic.src = src;
    fileMusic.wantLoop = opts.loop !== false;
    resumeCtx();
    if (!fileBuffers[src]) { loadFileBuffer(src); return false; }
    return startFileMusic();
  }

  function isFilePlaying(name) { return !!liveFiles[name]; }
  function isMusicFilePlaying() { return !!(fileMusic.node && fileMusic.name); }

  /* ------------------------------ volumes ------------------------------ */

  function setSfxVolume(v) {
    sfxVolume = clamp01(v);
    if (sfxBus) {
      try { sfxBus.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.02); }
      catch (e) { sfxBus.gain.value = sfxVolume; }
    }
  }

  function setMusicVolume(v) {
    musicVolume = clamp01(v);
    if (musicVol) {
      try { musicVol.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.02); }
      catch (e) { musicVol.gain.value = musicVolume; }
    }
  }

  /* --------------------------- public interface ------------------------ */

  var audio = MM.audio || (MM.audio = {});
  audio.init = init;
  audio.unlock = init;   // alias: call from a user gesture
  audio.isReady = isReady;
  audio.sfx = sfx;
  audio.music = musicPlay;
  audio.stopMusic = stopMusic;
  audio.stopAllSfx = stopAllSfx;
  audio.setSfxVolume = setSfxVolume;
  audio.setMusicVolume = setMusicVolume;
  audio.playFile = playFile;
  audio.stopFile = stopFile;
  audio.stopAllFiles = stopAllFiles;
  audio.setFileVolume = setFileVolume;
  audio.playMusicFile = playMusicFile;
  audio.stopMusicFile = stopFileMusic;
  audio.isFilePlaying = isFilePlaying;
  audio.isMusicFilePlaying = isMusicFilePlaying;
  audio.fileBuffers = fileBuffers;

  MM.AUDIO_READY = true;
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : this);

MM.AUDIO_READY = true;
