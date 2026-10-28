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
  var musicAn = null;          // analyser on the music bus: proves it is audible
  var musicAnBuf = null;
  var htmlMusic = null;        // <audio> fallback when Web Audio cannot play
  var htmlMusicName = null;
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
      try {
        musicAn = ctx.createAnalyser();
        musicAn.fftSize = 1024;
        musicFade.disconnect();
        musicFade.connect(musicAn);
        musicAn.connect(master);
      } catch (e) { musicAn = null; }

      resumeCtx(); // mobile: context often starts suspended
      // A room may have asked for music before the first user gesture; now
      // that we have a context, honour that request.
      if (fileMusic && fileMusic.src && fileMusic.name && !fileMusic.node) {
        if (fileBuffers[fileMusic.src]) startFileMusic();
        else loadFileBuffer(fileMusic.src);
      }
      // Sounds that were requested before there was a context are still queued;
      // replay them (latest first) so the first effect is not lost.
      for (var qk in pendingPlays) {
        var q = pendingPlays[qk];
        for (var qi = q.length - 1; qi >= 0; qi--) {
          try { playFile(q[qi].name, qk, q[qi].opts); } catch (e) { /* ignore */ }
        }
      }
      pendingPlays = {};
      preloadCommon();
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
    // Only the synthesized notes are stopped here.  The shared music bus is
    // NOT faded: file-backed music (the whole ported soundtrack) goes through
    // the same bus, so fading it to zero silenced every track that followed
    // -- the "music does not play" bug.  GML calls audio_stop_music() before
    // almost every audio_play_music(), so this fired on every room change.
    if (ctx) {
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
  var fileBytes = {};     // url -> ArrayBuffer (prefetched, not decoded yet)
  var fileBytesLoading = {};
  var fileBytesWaiters = {};
  var liveFiles = {};     // name -> [{ s: node }]
  var soundGain = {};     // name -> gain set by audio_sound_gain (persists)
  var pendingPlays = {};  // url -> [{ name, opts }] waiting for a decode
  var lastFileError = null;
  var fileMusic = { name: null, src: null, node: null, gain: null, wantLoop: true,
                    startAt: 0, offset: 0, paused: false };

  // Decoded PCM is what eats memory (~1.4 MB per stereo minute); keep a cap so
  // a long session cannot grow without bound.  Playing nodes hold their own
  // reference, so dropping a cache entry never cuts a sound short.
  var MAX_DECODED_BYTES = 96 * 1024 * 1024;
  var decodedBytes = 0;
  var decodedOrder = [];

  function isEffectUrl(url) { return /\.wav($|\?)/i.test(String(url)); }

  function rememberDecoded(url, buf) {
    var size = (buf.length || 0) * (buf.numberOfChannels || 2) * 4;
    if (!size || size > MAX_DECODED_BYTES) return;
    var rec = { url: url, size: size, pinned: isEffectUrl(url) };
    decodedOrder.push(rec);
    if (!rec.pinned) decodedBytes += size;
    var guard = 0;
    while (decodedBytes > MAX_DECODED_BYTES && decodedOrder.length > 1 && guard++ < 128) {
      var old = decodedOrder.shift();
      if (old.pinned) { decodedOrder.push(old); continue; }
      if (old.url === fileMusic.src && fileMusic.name) { decodedOrder.push(old); continue; }
      if (old.url in fileBuffers) delete fileBuffers[old.url];
      decodedBytes -= old.size;
    }
  }

  // ---- background decode of every effect --------------------------------
  // Decoding on first use costs a visible pause: the sound that was asked for
  // arrives late.  Effects are small (all of them together are ~47 MB of PCM),
  // so they are decoded once, slowly, in the background.
  var warmQueue = null;
  var warmActive = false;

  function warmPump() {
    if (!warmQueue || !warmQueue.length) { warmQueue = null; warmActive = false; return; }
    var src = warmQueue.shift();
    if (!fileBuffers[src] && !fileLoading[src]) loadFileBuffer(src);
    setTimeout(warmPump, 40);
  }

  function warmDecode() {
    if (warmActive) return true;
    if (!isReady() && !init()) return false;
    var list = [], sounds = MM.soundFiles || {};
    for (var n in sounds) {
      var f = sounds[n];
      if (!f || !f.src || fileBuffers[f.src] || !isEffectUrl(f.src)) continue;
      if (!fileBytes[f.src]) continue;   // not prefetched: leave it on demand
      list.push(f.src);
    }
    if (!list.length) return true;
    warmQueue = list;
    warmActive = true;
    setTimeout(warmPump, 30);
    return true;
  }

  function flushPending(url) {
    var q = pendingPlays[url];
    if (!q || !q.length) return;
    pendingPlays[url] = [];
    for (var i = 0; i < q.length; i++) {
      try { playFile(q[i].name, url, q[i].opts); } catch (e) {}
    }
  }

  function loadFileBuffer(url) {
    if (!url) return null;
    if (fileBuffers[url]) return fileBuffers[url];
    if (fileLoading[url]) return null;
    fileLoading[url] = true;
    try {
      var ready = fileBytes[url] ? Promise.resolve(fileBytes[url])
                                 : fetch(url).then(function (r) { return r.arrayBuffer(); });
      ready
        .then(function (ab) { fileBytes[url] = ab; return ctx.decodeAudioData(ab); })
        .then(function (buf) {
          fileBuffers[url] = buf;
          rememberDecoded(url, buf);
          fileLoading[url] = false;
          flushPending(url);
          if (fileMusic.src === url && fileMusic.name && !fileMusic.node) handOffMusic(url);
        })
        .catch(function (e) {
          fileLoading[url] = false;
          lastFileError = url + ': ' + (e && e.message ? e.message : String(e));
        });
    } catch (e) { fileLoading[url] = false; }
    return null;
  }

  function flushBytes(url, ok) {
    var list = fileBytesWaiters[url] || [];
    fileBytesWaiters[url] = [];
    for (var i = 0; i < list.length; i++) { try { list[i](ok); } catch (e) {} }
  }

  // Fetch the compressed bytes without decoding them.  The first real playback
  // then only pays for decodeAudioData(), not for a network round-trip.
  function prefetchFile(url, cb) {
    if (!url) { if (cb) cb(false); return; }
    if (fileBytes[url] || fileBuffers[url]) { if (cb) cb(true); return; }
    if (fileBytesLoading[url]) {
      (fileBytesWaiters[url] || (fileBytesWaiters[url] = [])).push(cb);
      return;
    }
    fileBytesLoading[url] = true;
    if (cb) (fileBytesWaiters[url] = fileBytesWaiters[url] || []).push(cb);
    try {
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (ab) {
          fileBytes[url] = ab;
          fileBytesLoading[url] = false;
          flushBytes(url, true);
        })
        .catch(function (e) {
          fileBytesLoading[url] = false;
          lastFileError = url + ': ' + (e && e.message ? e.message : String(e));
          flushBytes(url, false);
        });
    } catch (e) {
      fileBytesLoading[url] = false;
      flushBytes(url, false);
    }
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
    if (!buf) {
      // Not decoded yet: remember the request so it is not silently dropped,
      // and it will start the moment the decode finishes.
      var q = pendingPlays[src] || (pendingPlays[src] = []);
      q.push({ name: name, opts: opts });
      if (q.length > 4) q.shift();
      loadFileBuffer(src);
      return false;
    }
    // Restarting a non-looping sound exactly where it was paused: a real
    // resume plays the remainder, not the beginning again.
    var startOffset = 0;
    if (opts.offset) startOffset = Math.max(0, num(opts.offset, 0));
    if (!opts.loop && startOffset >= buf.duration) return false;
    stopFile(name);
    try {
      var node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = !!opts.loop;
      if (opts.pitch && node.playbackRate) node.playbackRate.value = Math.max(0.01, opts.pitch);
      var g = ctx.createGain();
      var baseGain = (soundGain[name] === undefined) ? 1 : soundGain[name];
      g.gain.value = clamp01((opts.volume === undefined ? 1 : opts.volume) * baseGain);
      node.connect(g);
      g.connect(opts.music ? musicVol : sfxBus);
      var rec = { s: node, g: g, src: src, opts: opts, startedAt: ctx.currentTime };
      var list = liveFiles[name] || (liveFiles[name] = []);
      list.push(rec);
      var gl = fileGains[name] || (fileGains[name] = []);
      gl.push(g);
      node.onended = function () {
        var l = liveFiles[name];
        if (l) {
          var at = l.indexOf(rec);
          if (at >= 0) l.splice(at, 1);
          if (!l.length) delete liveFiles[name];
        }
        var gg = fileGains[name];
        if (gg) {
          var gt = gg.indexOf(g);
          if (gt >= 0) gg.splice(gt, 1);
          if (!gg.length) delete fileGains[name];
        }
      };
      node.start(0, startOffset);
      return true;
    } catch (e) { return false; }
  }

  function setFileVolume(name, v, ms) {
    // GML's audio_sound_gain changes the sound *resource*: the value sticks and
    // applies to every later play of that sound.  The game depends on it --
    // EggmanBase1_23 sets the gain to 0, ramps it to 0.82 and only then starts
    // the looping track.
    var target = clamp01(v);
    soundGain[name] = target;
    var list = fileGains[name];
    if (!list || !list.length) return;
    var now = ctx.currentTime;
    var ramp = Math.max(0, num(ms, 0)) / 1000;
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      try {
        if (ramp > 0) {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(target, now + ramp);
        } else {
          g.gain.setValueAtTime(target, now);
        }
      } catch (e) { /* ignore */ }
    }
  }

  var fileGains = {};

  // ---- <audio> fallback -------------------------------------------------
  // Web Audio can fail where an element still works: decodeAudioData on a long
  // wav, a context the browser refuses to resume, a closed device.  If a track
  // was requested and no source node exists a few seconds later, the same file
  // goes to an element so the player still hears it.
  function level() {
    if (!musicAn) return 0;
    try {
      if (!musicAnBuf) musicAnBuf = new Float32Array(musicAn.fftSize);
      musicAn.getFloatTimeDomainData(musicAnBuf);
      var sum = 0;
      for (var i = 0; i < musicAnBuf.length; i++) { var v = musicAnBuf[i]; sum += v * v; }
      return Math.sqrt(sum / musicAnBuf.length);
    } catch (e) { return 0; }
  }

  function htmlMusicPlay() {
    if (!htmlMusic) return;
    var el = htmlMusic;
    try {
      var p = el.play();
      if (p && typeof p.catch === 'function') p.catch(function () {
        // Autoplay refused: release the element, otherwise startFileMusic()
        // would keep thinking the element owns playback and the track would
        // stay silent even after the Web Audio buffer is ready.
        if (htmlMusic === el) {
          htmlMusic = null;
          htmlMusicName = null;
          if (fileMusic.src && fileBuffers[fileMusic.src]) startFileMusic();
        }
      });
    } catch (e) {
      if (htmlMusic === el) { htmlMusic = null; htmlMusicName = null; }
    }
  }

  function htmlMusicStop() {
    if (!htmlMusic) return;
    try { htmlMusic.pause(); } catch (e) {}
    try { htmlMusic.removeAttribute('src'); htmlMusic.load(); } catch (e) {}
    htmlMusic = null;
    htmlMusicName = null;
  }

  function musicElement() {
    var src = fileMusic.src;
    if (!src || typeof Audio === 'undefined') return false;
    if (htmlMusic && htmlMusicName === src) { htmlMusicPlay(); return true; }
    htmlMusicStop();
    try {
      var el = new Audio();
      el.src = src;
      el.loop = fileMusic.wantLoop !== false;
      el.preload = 'auto';
      el.volume = clamp01(musicVolume * MASTER_VOL);
      el.onerror = function () {
        if (htmlMusic === el) { htmlMusic = null; htmlMusicName = null; }
      };
      htmlMusic = el;
      htmlMusicName = src;
      htmlMusicPlay();
      return true;
    } catch (e) {
      htmlMusic = null;
      htmlMusicName = null;
      return false;
    }
  }

  function musicWatch(name, src, attempt) {
    if (fileMusic.name !== name || fileMusic.src !== src) return;
    if (htmlMusic || fileMusic.paused) return;
    if (fileMusic.node) return;                       // web audio is playing it
    if (fileLoading[src] || fileBytesLoading[src]) {  // still fetching / decoding
      if (attempt < 2) setTimeout(function () { musicWatch(name, src, attempt + 1); }, 3000);
      return;
    }
    musicElement();
  }

  function scheduleMusicWatch(name, src) {
    if (typeof setTimeout !== 'function') return;
    setTimeout(function () { musicWatch(name, src, 0); }, 4000);
  }

  function stopFileMusic() {
    htmlMusicStop();
    if (fileMusic.node) { try { fileMusic.node.stop(0); } catch (e) {} }
    if (fileMusic.gain) { try { fileMusic.gain.disconnect(); } catch (e) {} }
    fileMusic.node = null; fileMusic.gain = null;
    fileMusic.name = null; fileMusic.src = null;
    fileMusic.offset = 0; fileMusic.startAt = 0; fileMusic.paused = false;
  }

  // Pause keeps the track (and the position) so resume can pick it up again.
  function pauseFileMusic() {
    if (htmlMusic) {
      fileMusic.offset = htmlMusic.currentTime || fileMusic.offset || 0;
      try { htmlMusic.pause(); } catch (e) {}
      fileMusic.paused = true;
      return true;
    }
    if (fileMusic.node) {
      var elapsed = Math.max(0, ctx.currentTime - fileMusic.startAt);
      fileMusic.offset = (fileMusic.offset + elapsed) % 1e9;
      try { fileMusic.node.stop(0); } catch (e) {}
      if (fileMusic.gain) { try { fileMusic.gain.disconnect(); } catch (e) {} }
      fileMusic.node = null; fileMusic.gain = null;
      fileMusic.paused = true;
    }
    return true;
  }

  function resumeFileMusic() {
    if (!fileMusic.name) return false;
    if (htmlMusic) {
      try { htmlMusic.currentTime = fileMusic.offset || 0; } catch (e) {}
      htmlMusicPlay();
      fileMusic.paused = false;
      return true;
    }
    if (fileMusic.node) return true;
    if (!isReady()) init();
    if (!isReady()) return false;
    if (!fileBuffers[fileMusic.src]) { loadFileBuffer(fileMusic.src); return false; }
    fileMusic.paused = false;
    return startFileMusic();
  }

  function startFileMusic() {
    if (htmlMusic) return true;        // the element owns playback now
    var buf = fileBuffers[fileMusic.src];
    if (!buf || !isReady()) return false;
    // A synthesized track may have left the shared bus faded out; a file track
    // must always come up at full bus level.
    if (musicFade) {
      try {
        var t0 = ctx.currentTime;
        musicFade.gain.cancelScheduledValues(t0);
        musicFade.gain.setValueAtTime(1, t0);
      } catch (e) { /* ignore */ }
    }
    try {
      var node = ctx.createBufferSource();
      node.buffer = buf;
      node.loop = fileMusic.wantLoop !== false;
      var g = ctx.createGain();
      g.gain.value = 0;
      node.connect(g);
      g.connect(musicVol);
      var from = fileMusic.offset || 0;
      if (buf.duration && from >= buf.duration) from = 0;
      node.start(0, from);
      var now = ctx.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + 0.4);
      fileMusic.node = node;
      fileMusic.gain = g;
      fileMusic.startAt = now;
      fileMusic.paused = false;
      return true;
    } catch (e) { return false; }
  }

  // When the buffered (Web Audio) version of the track becomes available after
  // the <audio> element already started it, hand playback over at the same
  // position: element playback ignores volume ramps, the node does not.
  function handOffMusic(url) {
    if (!(fileMusic.src === url) || !fileMusic.name) return;
    if (fileMusic.node) return;
    if (htmlMusic) {
      var t = 0;
      try { t = htmlMusic.currentTime || 0; } catch (e) { t = 0; }
      fileMusic.offset = t;
      htmlMusicStop();
    }
    startFileMusic();
  }

  function playMusicFile(name, src, opts) {
    opts = opts || {};
    if (fileMusic.name === name && fileMusic.node) return true;
    if (fileMusic.name === name && fileMusic.paused) {
      // same track, was paused: continue where it left off
      fileMusic.wantLoop = opts.loop !== false;
      return resumeFileMusic();
    }
    stopFileMusic();
    if (!src) return false;
    fileMusic.name = name;
    fileMusic.src = src;
    fileMusic.wantLoop = opts.loop !== false;
    scheduleMusicWatch(name, src);
    if (!isReady()) init();          // allowed: the context starts suspended
    resumeCtx();
    if (!isReady()) return false;    // truly headless (no AudioContext)
    if (!fileBuffers[src]) {
      loadFileBuffer(src);
      // Decoding a multi-minute OGG takes seconds on the first visit, and the
      // track then started only after the black transition.  Start it through
      // an <audio> element immediately; handOffMusic() switches to the decoded
      // buffer at the same position once it is ready (volume ramps etc.).
      try { musicElement(); } catch (e) { /* ignore */ }
      return false;
    }
    return startFileMusic();
  }

  function isFilePlaying(name) { return !!liveFiles[name]; }
  function isMusicFilePlaying(name) {
    return !!((fileMusic.node || htmlMusic) && fileMusic.name && (!name || fileMusic.name === name));
  }

  /* ------------------------------ volumes ------------------------------ */

  function setSfxVolume(v) {
    sfxVolume = clamp01(v);
    if (sfxBus) {
      try { sfxBus.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.02); }
      catch (e) { sfxBus.gain.value = sfxVolume; }
    }
  }

  function setMusicVolume(v, ms) {
    musicVolume = clamp01(v);
    if (htmlMusic) { try { htmlMusic.volume = clamp01(musicVolume * MASTER_VOL); } catch (e) {} }
    if (!musicVol) return;
    var now = ctx.currentTime;
    var ramp = Math.max(0, num(ms, 0)) / 1000;
    try {
      if (ramp > 0) {
        musicVol.gain.cancelScheduledValues(now);
        musicVol.gain.setValueAtTime(musicVol.gain.value, now);
        musicVol.gain.linearRampToValueAtTime(musicVolume, now + ramp);
      } else {
        musicVol.gain.setValueAtTime(musicVolume, now);
      }
    } catch (e) { musicVol.gain.value = musicVolume; }
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

  // ---- background warm-up of the most used sound effects ---------------
  var preloadStarted = false;

  function preloadCommon() {
    if (preloadStarted || typeof setTimeout !== 'function') return;
    preloadStarted = true;
    var list = MM.PRELOAD_SOUNDS || [];
    var i = 0;
    var pump = function () {
      if (i >= list.length) return;
      var f = MM.soundFiles && MM.soundFiles[list[i++]];
      // After MM.preloadAll the bytes are already local: decoding here would
      // only burn memory up front.  Playback decodes on demand instead.
      if (f && f.src && !fileBytes[f.src]) loadFileBuffer(f.src);
      setTimeout(pump, 400);
    };
    setTimeout(pump, 500);
  }
  audio.preloadCommon = preloadCommon;
  audio.preloadNames = function (names) {
    for (var i = 0; i < (names || []).length; i++) {
      var f = MM.soundFiles && MM.soundFiles[names[i]];
      if (f && f.src) loadFileBuffer(f.src);
    }
  };

  audio.playMusicFile = playMusicFile;
  audio.stopMusicFile = stopFileMusic;
  audio.prefetchFile = prefetchFile;
  audio.level = level;
  audio.warmDecode = warmDecode;
  audio.usingElement = function () { return !!htmlMusic; };
  audio.memoryState = function () {
    return { decodedBytes: decodedBytes, decodedCount: decodedOrder.length,
             rawBytes: (function () { var b = 0; for (var k in fileBytes) b += fileBytes[k].byteLength || 0; return b; })() };
  };
  audio.preloadedBytes = function () {
    var n = 0, b = 0;
    for (var k in fileBytes) { n++; b += fileBytes[k].byteLength || 0; }
    return { files: n, bytes: b };
  };
  // ---- pause / resume of *all* file sounds ------------------------------
  // GML `audio_pause_all` must not destroy anything: looping machinery sounds
  // (engines, Hum) P.AUSER relies on must come back exactly on resume.  A
  // stopped buffer-source can't pause in place, so we remember what was live,
  // where it was, and restart it on resume.  Loops restart at 0, one-shots
  // continue from their offset (and are dropped if already finished).
  var pauseResumeList = [];

  function pauseAllFiles() {
    pauseResumeList = [];
    for (var name in liveFiles) {
      var l = liveFiles[name].slice();
      for (var i = 0; i < l.length; i++) {
        var rec = l[i];
        var offset = 0;
        try { offset = Math.max(0, ctx.currentTime - (rec.startedAt || 0)); } catch (e) {}
        pauseResumeList.push({ name: name, src: rec.src, opts: rec.opts || {}, offset: offset });
        try { rec.s.onended = null; rec.s.stop(0); } catch (e) {}
      }
      delete liveFiles[name];
    }
    // fileGains now point at dead gain nodes: clear, they are rebuilt on play
    for (var gname in fileGains) delete fileGains[gname];
    pauseFileMusic();
  }

  function resumeAllFiles() {
    var list = pauseResumeList;
    pauseResumeList = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var opts = {};
      for (var k in r.opts) opts[k] = r.opts[k];
      if (opts.loop || !r.offset) {
        delete opts.offset;
      } else {
        opts.offset = r.offset; // continue one-shots where they were
      }
      try { playFile(r.name, r.src, opts); } catch (e) { /* ignore */ }
    }
    resumeFileMusic();
  }

  audio.pauseMusicFile = pauseFileMusic;
  audio.resumeMusicFile = resumeFileMusic;
  audio.pauseAllFiles = pauseAllFiles;
  audio.resumeAllFiles = resumeAllFiles;
  audio.isFilePlaying = isFilePlaying;
  audio.isMusicFilePlaying = isMusicFilePlaying;
  audio.fileBuffers = fileBuffers;

  // Live nodes, for diagnostics only (no game code uses this).
  audio.debugNodes = function () {
    return {
      ctx: ctx ? { state: ctx.state, time: ctx.currentTime, rate: ctx.sampleRate } : null,
      master: master ? master.gain.value : null,
      musicVol: musicVol ? musicVol.gain.value : null,
      musicFade: musicFade ? musicFade.gain.value : null,
      analyser: !!musicAn,
      musicNode: fileMusic.node ? { loop: fileMusic.node.loop, rate: fileMusic.node.playbackRate.value } : null,
      musicGain: fileMusic.gain ? fileMusic.gain.gain.value : null,
      musicSrc: fileMusic.src, musicName: fileMusic.name
    };
  };

  audio.debugSound = function (name) {
    var l = fileGains[name] || [];
    return { stored: soundGain[name], live: l.map(function (g) { return g.gain.value; }),
             playing: !!liveFiles[name] };
  };

  // Everything a support report needs, in one object.
  audio.debugState = function () {
    var loading = 0, names = [];
    for (var k in fileLoading) if (fileLoading[k]) { loading++; names.push(k); }
    return {
      ctx: ctx ? ctx.state : null,
      master: MASTER_VOL,
      musicVolume: musicVolume,
      buffers: Object.keys(fileBuffers).length,
      loading: loading,
      loadingNames: names.slice(0, 5),
      live: Object.keys(liveFiles).length,
      music: fileMusic.name,
      musicNode: !!fileMusic.node,
      musicPaused: !!fileMusic.paused,
      musicOffset: fileMusic.offset ? +fileMusic.offset.toFixed(2) : 0,
      element: !!htmlMusic,
      level: +level().toFixed(4),
      warm: warmActive,
      pending: (function () { var n = 0; for (var k in pendingPlays) n += pendingPlays[k].length; return n; })(),
      lastError: lastFileError
    };
  };

  MM.AUDIO_READY = true;
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : this);

MM.AUDIO_READY = true;
