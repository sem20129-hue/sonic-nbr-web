/* mm_nbr.js вЂ” GameMaker Studio 1.4 compatibility layer.
 *
 * Adds to the MiniMaker runtime everything the original
 * "Sonic.exe: Nightmare Beginning Remake" (GMS 1.4) needs:
 *   - image backed sprites (real PNG frames + collision masks)
 *   - background layers (tiling, parallax, foreground)
 *   - per-pixel collision masks for the player characters
 *   - per-object key press / key release events
 *   - instance creation code (parent code -> code -> Create event)
 *   - bitmap fonts (the game ships 5 of them) + draw_text_color
 *   - the GMS 1.4 builtins the original code calls
 *   - file backed sound/music playback
 *
 * Loaded AFTER mm_core.js / mm_interp.js / mm_builtins.js / mm_audio.js.
 */
(function (root) {
  'use strict';

  var MM = root.MM = root.MM || {};
  var B = (MM.builtins = MM.builtins || {});
  var C = (MM.constants = MM.constants || {});

  MM.soundFiles = MM.soundFiles || {};
  MM.soundIndex = MM.soundIndex || {};
  MM.fonts = MM.fonts || {};
  MM.bgImages = MM.bgImages || {};
  MM.paths = MM.paths || {};

  var hasImage = (typeof Image !== 'undefined');
  var hasCanvas = (typeof document !== 'undefined' && !!document.createElement);

  function num(v, d) { v = Number(v); return isFinite(v) ? v : (d === undefined ? 0 : d); }
  function str(v) { return (v === undefined || v === null) ? '' : String(v); }

  /* ===================================================================== */
  /*  Image backed sprites                                                  */
  /* ===================================================================== */

  MM.spriteImage = function (def) {
    if (!def || !def.name) { MM.warn('MM.spriteImage: РЅРµС‚ РёРјРµРЅРё'); return null; }
    def.kind = 'image';
    def.w = num(def.w, 1);
    def.h = num(def.h, 1);
    def.originPx = def.origin || [Math.floor(def.w / 2), Math.floor(def.h / 2)];
    def.origin = [def.originPx[0] / def.w, def.originPx[1] / def.h];
    def.frames = def.frames || [];
    if (!def.bbox) {
      // fall back to the full sprite rect; the mask refines it later
      def.bbox = { l: -def.originPx[0], t: -def.originPx[1], r: def.w - def.originPx[0], b: def.h - def.originPx[1] };
    }
    MM.sprites[def.name] = def;
    return def;
  };

  // Lazily loads the PNG for a frame. Returns null until it is ready.
  MM.imageFrame = function (spr, idx) {
    var f = spr.frames[idx];
    if (!f) return null;
    if (f.img) return f.img;
    if (!hasImage) return null;
    if (!f._tried) {
      f._tried = true;
      var im = new Image();
      im.onload = function () { f.img = im; };
      im.onerror = function () { f.img = null; };
      im.src = f.src;
    }
    return null;
  };

  // Preload every frame of a sprite (used when a room is loaded).
  MM.preloadSprite = function (spr) {
    if (!spr || spr.kind !== 'image') return;
    for (var i = 0; i < spr.frames.length; i++) MM.imageFrame(spr, i);
  };

  /* ===================================================================== */
  /*  Background layers                                                     */
  /* ===================================================================== */

  MM.bgImage = function (src) {
    if (src && typeof src === 'object') src = src.src || null;
    if (!src) return null;
    if (!MM._bgCache) MM._bgCache = {};
    var hit = MM._bgCache[src];
    if (hit !== undefined) return hit;
    var im = null;
    if (hasImage) {
      im = new Image();
      im.onload = function () { im._ready = true; };
      im.onerror = function () { im._failed = true; };
      im.src = src;
    }
    MM._bgCache[src] = im;
    return im;
  };

  /* --------------------------------------------------------------------- */
  /*  GameMaker background layers (8 slots, live state)                     */
  /* --------------------------------------------------------------------- */

  var BG_SLOTS = 8;

  MM.bg = MM.bg || null;

  function bgInit(room) {
    var i;
    var S = {
      img: [], visible: [], foreground: [], x: [], y: [],
      hspeed: [], vspeed: [], alpha: [], blend: [],
      htiled: [], vtiled: [], stretch: [],
      speedX: [], speedY: [], baseX: [], baseY: [], width: [], height: []
    };
    for (i = 0; i < BG_SLOTS; i++) {
      S.img[i] = null; S.visible[i] = false; S.foreground[i] = false;
      S.x[i] = 0; S.y[i] = 0; S.hspeed[i] = 0; S.vspeed[i] = 0;
      S.alpha[i] = 1; S.blend[i] = -1;
      S.htiled[i] = true; S.vtiled[i] = true; S.stretch[i] = false;
      S.speedX[i] = 0; S.speedY[i] = 0;
      S.baseX[i] = 0; S.baseY[i] = 0; S.width[i] = 0; S.height[i] = 0;
    }
    var layers = (room && room.bgLayers) || [];
    for (i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L) continue;
      var k = (L.idx == null) ? i : (L.idx | 0);
      if (k < 0 || k >= BG_SLOTS) continue;
      S.img[k] = L.img || null;
      S.visible[k] = !!L.enabled;
      S.foreground[k] = !!L.foreground;
      S.baseX[k] = num(L.x, 0);
      S.baseY[k] = num(L.y, 0);
      S.htiled[k] = L.tiledH !== false;
      S.vtiled[k] = L.tiledV !== false;
      S.stretch[k] = !!L.stretch;
      S.speedX[k] = num(L.speedX, 0);
      S.speedY[k] = num(L.speedY, 0);
    }
    S.room = room;
    S.frame = (MM.state && MM.state.frame) || 0;
    MM.bg = S;
  }

  // GM moves a background by its own speed every step.  The port advances on
  // render by the number of steps that ran since the previous frame, so the
  // scroll does not depend on who owns MM.onStep.
  function bgTick() {
    var S = MM.bg;
    if (!S) return;
    var frame = (MM.state && MM.state.frame) || 0;
    var steps = frame - (S.frame == null ? frame : S.frame);
    S.frame = frame;
    if (steps < 0) steps = 0;
    if (steps > 4) steps = 4;
    for (var i = 0; i < BG_SLOTS; i++) {
      if (S.hspeed[i] && steps) S.x[i] += S.hspeed[i] * steps;
      if (S.vspeed[i] && steps) S.y[i] += S.vspeed[i] * steps;
      if (S.img[i] && !S.width[i]) {
        var url = S.img[i];
        if (url && typeof url === 'object') url = url.src;
        if (url) {
          var im = MM.bgImage(url);
          if (im && im.width) { S.width[i] = im.width; S.height[i] = im.height; }
        }
      }
    }
  }

  MM.gfx.drawBackgrounds = function (ctx, room, vx, vy, foreground) {
    var S = MM.bg;
    if (!S || S.room !== room) { bgInit(room); S = MM.bg; }
    if (!foreground) bgTick();
    var act = MM.activeView ? MM.activeView() : null;
    var spanW = act ? act.w : (room && room.view ? room.view.w : MM.VIEW_W);
    var spanH = act ? act.h : (room && room.view ? room.view.h : MM.VIEW_H);
    for (var i = 0; i < BG_SLOTS; i++) {
      if (!S.visible[i]) continue;
      if (!!S.foreground[i] !== !!foreground) continue;
      var url = S.img[i];
      if (url && typeof url === 'object') url = url.src;
      if (!url) continue;
      var img = MM.bgImage(url);
      if (!img || !img.width || !img.height) continue;
      var alpha = num(S.alpha[i], 1);
      if (alpha <= 0) continue;
      var drawn = (S.blend[i] !== -1 && S.blend[i] !== undefined && S.blend[i] !== null)
        ? bgTinted(img, S.blend[i]) : img;
      var baseX = S.baseX[i] + S.x[i] - vx * num(S.speedX[i], 0) / 100;
      var baseY = S.baseY[i] + S.y[i] - vy * num(S.speedY[i], 0) / 100;
      var prevA = ctx.globalAlpha;
      ctx.globalAlpha = Math.max(0, Math.min(1, prevA * alpha));
      if (S.stretch[i]) {
        ctx.drawImage(drawn, baseX, baseY, room.w, room.h);
        ctx.globalAlpha = prevA;
        continue;
      }
      var iw = img.width, ih = img.height;
      var col0 = Math.floor((vx - baseX) / iw);
      var col1 = Math.ceil((vx + spanW - baseX) / iw);
      var row0 = Math.floor((vy - baseY) / ih);
      var row1 = Math.ceil((vy + spanH - baseY) / ih);
      // A slot that is not tiled is drawn once, wherever it sits in the room.
      if (!S.htiled[i]) { col0 = 0; col1 = 0; }
      if (!S.vtiled[i]) { row0 = 0; row1 = 0; }
      for (var c = col0; c <= col1; c++) {
        for (var r = row0; r <= row1; r++) {
          ctx.drawImage(drawn, Math.round(baseX + c * iw), Math.round(baseY + r * ih));
        }
      }
      ctx.globalAlpha = prevA;
    }
  };

  // ---- GML access ------------------------------------------------------
  // Returning the live arrays makes `background_visible[2] = true` work: the
  // interpreter assigns into base[index] on whatever the getter returned.
  (function () {
    var V = MM.builtinVars;
    if (!V) return;
    V.background_visible = { get: function () { bgEnsure(); return MM.bg.visible; } };
    V.background_foreground = { get: function () { bgEnsure(); return MM.bg.foreground; } };
    V.background_x = { get: function () { bgEnsure(); return MM.bg.x; } };
    V.background_y = { get: function () { bgEnsure(); return MM.bg.y; } };
    V.background_hspeed = { get: function () { bgEnsure(); return MM.bg.hspeed; } };
    V.background_vspeed = { get: function () { bgEnsure(); return MM.bg.vspeed; } };
    V.background_alpha = { get: function () { bgEnsure(); return MM.bg.alpha; } };
    V.background_blend = { get: function () { bgEnsure(); return MM.bg.blend; } };
    V.background_htiled = { get: function () { bgEnsure(); return MM.bg.htiled; } };
    V.background_vtiled = { get: function () { bgEnsure(); return MM.bg.vtiled; } };
    V.background_width = { get: function () { bgEnsure(); return MM.bg.width; } };
    V.background_height = { get: function () { bgEnsure(); return MM.bg.height; } };
    V.background_index = { get: function () { bgEnsure(); return MM.bg.img; } };
  })();

  // The getters below make sure a room has state even if no frame was drawn yet.
  function bgEnsure() {
    if (!MM.bg || MM.bg.room !== MM.state.room) bgInit(MM.state.room);
  }

  /* ===================================================================== */
  /*  Pixel collision masks                                                 */
  /* ===================================================================== */

  var maskCache = {};   // src -> { w, h, data }

  var maskLoading = Object.create(null);
  var maskWaiters = Object.create(null);

  function flushMask(src) {
    var list = maskWaiters[src] || [];
    maskWaiters[src] = [];
    for (var i = 0; i < list.length; i++) { try { list[i](!!maskCache[src]); } catch (e) {} }
  }

  function maskData(src, cb) {
    if (!src) { if (cb) cb(false); return null; }
    if (maskCache[src]) { if (cb) cb(true); return maskCache[src]; }
    if (!hasImage || !hasCanvas) { if (cb) cb(false); return null; }
    if (cb) (maskWaiters[src] = maskWaiters[src] || []).push(cb);
    if (maskLoading[src]) return null;
    maskLoading[src] = true;
    var im = new Image();
    im.onload = function () {
      try {
        var cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        var c2 = cv.getContext('2d');
        c2.drawImage(im, 0, 0);
        var d = c2.getImageData(0, 0, cv.width, cv.height).data;
        // opaque horizontal runs per row -- lets mask-vs-rectangle tests skip
        // the per-pixel loop entirely
        var rows = new Array(cv.height);
        for (var ry = 0; ry < cv.height; ry++) {
          var runs = [];
          var rx = 0;
          while (rx < cv.width) {
            if (d[(ry * cv.width + rx) * 4 + 3] > 16) {
              var s0 = rx;
              while (rx < cv.width && d[(ry * cv.width + rx) * 4 + 3] > 16) rx++;
              runs.push([s0, rx - 1]);
            } else {
              rx++;
            }
          }
          rows[ry] = runs;
        }
        maskCache[src] = { w: cv.width, h: cv.height, data: d, rows: rows };
      } catch (e) { /* tainted canvas etc. */ }
      maskLoading[src] = false;
      flushMask(src);
    };
    im.onerror = function () { maskLoading[src] = false; flushMask(src); };
    im.src = src;
    return null;
  }

  MM.preloadMask = function (src) { if (src) maskData(src); };

  function maskHit(spr) {
    if (!spr || spr.kind !== 'image' || !spr.mask) return null;
    var m = maskData(spr.mask);
    return m;
  }

  // Is the world pixel (px,py) inside this instance's sprite mask?
  function maskContains(inst, spr, m, px, py) {
    if (!m) return true;
    var ox = spr.originPx ? spr.originPx[0] : 0;
    var oy = spr.originPx ? spr.originPx[1] : 0;
    var sx = inst.image_xscale || 1;
    var sy = inst.image_yscale || 1;
    var lx = Math.floor((px - inst.x) / (sx || 1) + ox);
    var ly = Math.floor((py - inst.y) / (sy || 1) + oy);
    if (lx < 0 || ly < 0 || lx >= m.w || ly >= m.h) return false;
    var a = m.data[(ly * m.w + lx) * 4 + 3];
    return a > 16;
  }


  // Does this instance's mask have any opaque pixel inside the world box?
  function maskHitsBox(inst, spr, m, box) {
    if (!m.rows) return true;
    var ox = spr.originPx ? spr.originPx[0] : 0;
    var oy = spr.originPx ? spr.originPx[1] : 0;
    var sx = inst.image_xscale || 1;
    var sy = inst.image_yscale || 1;
    var ly0 = Math.floor((box.t - inst.y) / (sy || 1) + oy);
    var ly1 = Math.ceil((box.b - inst.y) / (sy || 1) + oy);
    if (ly0 < 0) ly0 = 0;
    if (ly1 > m.h - 1) ly1 = m.h - 1;
    for (var ly = ly0; ly <= ly1; ly++) {
      var runs = m.rows[ly];
      if (!runs || !runs.length) continue;
      for (var i = 0; i < runs.length; i++) {
        var wx0 = inst.x + (runs[i][0] - ox) * sx;
        var wx1 = inst.x + (runs[i][1] + 1 - ox) * sx;
        if (wx0 < box.r && wx1 > box.l) return true;
      }
    }
    return false;
  }

  MM.collides = function (a, b, boxA, boxB) {
    if (!(boxA.l < boxB.r && boxA.r > boxB.l && boxA.t < boxB.b && boxA.b > boxB.t)) return false;
    var sprA = a.sprite_index, sprB = b.sprite_index;
    var mA = (a.object_index && a.object_index.maskKind === 'mask') ? maskHit(sprA) : null;
    var mB = (b.object_index && b.object_index.maskKind === 'mask') ? maskHit(sprB) : null;
    if (!mA && !mB) return true;
    if (mA && !mB) return maskHitsBox(a, sprA, mA, boxB);
    if (mB && !mA) return maskHitsBox(b, sprB, mB, boxA);
    var l = Math.max(boxA.l, boxB.l), r = Math.min(boxA.r, boxB.r);
    var t = Math.max(boxA.t, boxB.t), bo = Math.min(boxA.b, boxB.b);
    var step = ((r - l) * (bo - t) > 40000) ? 2 : 1;
    for (var x = l; x < r; x += step) {
      for (var y = t; y < bo; y += step) {
        var inA = mA ? maskContains(a, sprA, mA, x, y) : (x >= boxA.l && x < boxA.r && y >= boxA.t && y < boxA.b);
        if (!inA) continue;
        var inB = mB ? maskContains(b, sprB, mB, x, y) : (x >= boxB.l && x < boxB.r && y >= boxB.t && y < boxB.b);
        if (inB) return true;
      }
    }
    return false;
  };

  /* ===================================================================== */
  /*  Key events                                                           */
  /* ===================================================================== */

  MM.dispatchKeyEvents = function () {
    var pressed = MM.input.pressed, released = MM.input.released;
    var list = MM.state.instances;
    for (var code in pressed) {
      if (!pressed[code]) continue;
      var ev = 'key_press_' + code;
      for (var i = 0; i < list.length; i++) {
        if (list[i]._destroyed || list[i]._deactivated) continue;
        if (MM.eventCode(list[i].object_index, ev)) MM.runEvent(list[i], ev);
      }
    }
    for (var code2 in released) {
      if (!released[code2]) continue;
      var ev2 = 'key_release_' + code2;
      for (var j = 0; j < list.length; j++) {
        if (list[j]._destroyed || list[j]._deactivated) continue;
        if (MM.eventCode(list[j].object_index, ev2)) MM.runEvent(list[j], ev2);
      }
    }
  };

  /* ===================================================================== */
  /*  Instance creation code                                                */
  /* ===================================================================== */

  MM.runInstanceCode = function (spec, inst) {
    if (spec.pc) {
      var pc = MM.resolveCode(spec.pc);
      if (pc) MM.interp.run(pc, { self: inst, other: MM.NOONE, name: 'pre_create_code' });
    }
    if (spec.cc) {
      var cc = MM.resolveCode(spec.cc);
      if (cc) MM.interp.run(cc, { self: inst, other: MM.NOONE, name: 'create_code' });
    }
    MM.runEvent(inst, 'create');
  };

  /* ===================================================================== */
  /*  Bitmap fonts                                                         */
  /* ===================================================================== */

  MM.defineFont = function (name, src, glyphs, meta) {
    var f = { name: name, src: src, glyphs: {}, list: glyphs || [], meta: meta || null, img: null, _tried: false };
    for (var i = 0; i < f.list.length; i++) {
      var g = f.list[i];
      if (g && g.ch !== undefined && g.ch !== null) f.glyphs[g.ch] = g;
    }
    MM.fonts[name] = f;
    return f;
  };

  MM.fontImage = function (f) {
    if (!f) return null;
    if (f.img) return f.img;
    if (!hasImage) return null;
    if (!f._tried) {
      f._tried = true;
      var im = new Image();
      im.onload = function () { f.img = im; };
      im.onerror = function () { f.img = null; };
      im.src = f.src;
    }
    return null;
  };

  function currentFont() {
    var f = MM.gfx.font;
    if (f && typeof f === 'object' && f.glyphs) return f;
    if (typeof f === 'string' && MM.fonts[f]) return MM.fonts[f];
    return null;
  }

  function fontLineHeight(f) {
    if (f.meta && f.meta.lineHeight) return f.meta.lineHeight;
    if (f._lineH) return f._lineH;
    var mh = 12;
    for (var k in f.glyphs) {
      var g = f.glyphs[k];
      if (g && g.h > mh) mh = g.h;
    }
    f._lineH = Math.max(12, Math.round(mh * 0.8));
    return f._lineH;
  }

  // GMS uses '#' as the line separator in every draw_text* call.
  function textLines(s) { return String(s).split(/#|\n/); }

  function fontTextWidth(f, text) {
    var lines = textLines(text), w = 0;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li], lw = 0;
      for (var i = 0; i < line.length; i++) {
        var g = f.glyphs[line[i]];
        lw += g ? (g.shift != null ? g.shift : g.w) : 4;
      }
      if (lw > w) w = lw;
    }
    return w;
  }

  function drawBitmapText(ctx, f, x, y, text, colorFn) {
    var img = MM.fontImage(f);
    if (!img) return false;
    var lineH = fontLineHeight(f);
    var lines = textLines(text);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var pen = x, ly = y + li * lineH;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        var g = f.glyphs[ch];
        if (!g) { pen += 4; continue; }
        if (colorFn) colorFn(ctx, g, pen, ly);
        else ctx.drawImage(img, g.x, g.y, g.w, g.h,
          Math.round(pen + (g.offset || 0)), Math.round(ly), g.w, g.h);
        pen += (g.shift != null ? g.shift : g.w);
      }
    }
    return true;
  }

  function gmsColor(c) {
    c = num(c, 0) | 0;
    var r = c & 0xFF, g = (c >> 8) & 0xFF, b = (c >> 16) & 0xFF;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function gmsColorA(c, a) {
    c = num(c, 0) | 0;
    var r = c & 0xFF, g = (c >> 8) & 0xFF, b = (c >> 16) & 0xFF;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* --- draw_text / draw_text_color ------------------------------------- */

  function textX(x, w) {
    if (MM.gfx.halign === 1) return x - w / 2;
    if (MM.gfx.halign === 2) return x - w;
    return x;
  }

  var textCache = Object.create(null);
  var textCacheCount = 0;
  var TEXT_PAD = 8;

  function paintGlyphs(tc, img, f, s, pad, lineH) {
    var lines = textLines(s);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li], pen = pad, ly = pad + li * lineH;
      for (var i = 0; i < line.length; i++) {
        var g = f.glyphs[line[i]];
        if (!g) { pen += 4; continue; }
        tc.drawImage(img, g.x, g.y, g.w, g.h, pen + (g.offset || 0), ly, g.w, g.h);
        pen += (g.shift != null ? g.shift : g.w);
      }
    }
  }

  function renderColorText(f, img, s, c1, c2, c3, c4, alpha) {
    var lines = textLines(s);
    var lineH = fontLineHeight(f);
    var w = Math.max(1, Math.ceil(fontTextWidth(f, s)));
    var cw = w + TEXT_PAD * 2;
    var chh = lineH * lines.length + TEXT_PAD * 2;

    var tmp = document.createElement('canvas');
    tmp.width = cw; tmp.height = chh;
    var tc = tmp.getContext('2d');
    paintGlyphs(tc, img, f, s, TEXT_PAD, lineH);

    // horizontal pass c1 -> c2, masked by the glyph alpha
    tc.globalCompositeOperation = 'source-in';
    var gh = tc.createLinearGradient(0, 0, cw, 0);
    gh.addColorStop(0, gmsColorA(c1, alpha));
    gh.addColorStop(1, gmsColorA(c2, alpha));
    tc.fillStyle = gh;
    tc.fillRect(0, 0, cw, chh);

    // vertical pass c3 -> c4 on its own canvas, then multiply the glyphs only
    if (c3 !== c1 || c4 !== c2) {
      var tmp2 = document.createElement('canvas');
      tmp2.width = cw; tmp2.height = chh;
      var tc2 = tmp2.getContext('2d');
      paintGlyphs(tc2, img, f, s, TEXT_PAD, lineH);
      tc2.globalCompositeOperation = 'source-in';
      var gv = tc2.createLinearGradient(0, 0, 0, chh);
      gv.addColorStop(0, gmsColorA(c3, alpha));
      gv.addColorStop(1, gmsColorA(c4, alpha));
      tc2.fillStyle = gv;
      tc2.fillRect(0, 0, cw, chh);
      tc.globalCompositeOperation = 'multiply';
      tc.drawImage(tmp2, 0, 0);
    }
    tc.globalCompositeOperation = 'source-over';
    return tmp;
  }

  function cachedColorText(f, img, s, c1, c2, c3, c4, alpha) {
    var key = f.name + '|' + (c1 | 0) + '|' + (c2 | 0) + '|' + (c3 | 0) + '|' +
              (c4 | 0) + '|' + alpha + '|' + s;
    var hit = textCache[key];
    if (hit) return hit;
    var cv = renderColorText(f, img, s, c1, c2, c3, c4, alpha);
    if (!cv) return null;
    if (textCacheCount > 400) { textCache = Object.create(null); textCacheCount = 0; }
    textCache[key] = cv;
    textCacheCount++;
    return cv;
  }

  B.draw_text = function (ctx, args) {
    var x = num(args[0]), y = num(args[1]), s = str(args[2]);
    if (!s.length) return 0;
    var c = MM.gfxCtx;
    if (!c) return 0;
    var f = currentFont();
    if (f) {
      var w = fontTextWidth(f, s);
      drawBitmapText(c, f, textX(x, w), y, s, null);
      return 0;
    }
    c.font = MM.gfx.font || '12px monospace';
    c.textAlign = 'left';
    c.fillStyle = MM.gfx.color;
    c.fillText(s, x, y);
    return 0;
  };

  B.draw_text_color = function (ctx, args) {
    var x = num(args[0]), y = num(args[1]), s = str(args[2]);
    var c1 = args[3], c2 = args[4], c3 = args[5], c4 = args[6];
    var alpha = args.length > 7 ? num(args[7], 1) : 1;
    if (!s.length) return 0;
    var c = MM.gfxCtx;
    if (!c) return 0;

    var f = currentFont();
    if (f && hasCanvas) {
      var img = MM.fontImage(f);
      if (img) {
        var tex = cachedColorText(f, img, s, c1, c2, c3, c4, alpha);
        if (tex) {
          var w2 = fontTextWidth(f, s);
          c.drawImage(tex, Math.round(textX(x, w2) - TEXT_PAD), Math.round(y - TEXT_PAD));
          return 0;
        }
      }
    }
    // fallback: plain canvas text with a vertical gradient
    try {
      c.font = MM.gfx.font || '12px monospace';
      c.textAlign = 'left';
      var gr3 = c.createLinearGradient(0, y, 0, y + 12);
      gr3.addColorStop(0, gmsColorA(c1, alpha));
      gr3.addColorStop(1, gmsColorA(c3, alpha));
      c.fillStyle = gr3;
      c.fillText(textLines(s).join(' '), x, y);
    } catch (e) { /* ignore */ }
    return 0;
  };

  B.draw_set_font = function (ctx, args) {
    MM.gfx.font = args[0];
    return 0;
  };

  /* ===================================================================== */
  /*  Sound files                                                           */
  /* ===================================================================== */

  MM.defineSoundFile = function (name, src, opts) {
    opts = opts || {};
    var d = {
      name: name, src: src, kind: 'file',
      volume: opts.volume === undefined ? 1 : opts.volume,
      pitch: opts.pitch === undefined ? 0 : opts.pitch,
      loop: !!opts.loop
    };
    MM.soundFiles[name] = d;
    MM.sounds[name] = d;   // so the interpreter resolves the bare name
    return d;
  };

  // The generated package calls MM.defineSound(name, src, opts) for real
  // files, while the synthesizer uses MM.defineSound(def). Support both.
  if (MM.defineSound && !MM._defineSoundPatched) {
    var origDefineSound = MM.defineSound;
    MM.defineSound = function (a, b, c) {
      if (typeof a === 'string') return MM.defineSoundFile(a, b, c || {});
      return origDefineSound(a);
    };
    MM._defineSoundPatched = true;
  }

  if (MM.audio && MM.audio.sfx) {
    var origSfx = MM.audio.sfx;
    MM.audio.sfx = function (name) {
      var f = MM.soundFiles[name];
      if (f) return MM.audio.playFile(name, f.src, { loop: f.loop, volume: f.volume, pitch: f.pitch });
      return origSfx(name);
    };
  }

  function resolveSound(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') {
      var nm = MM.soundIndex[v];
      return nm ? (MM.soundFiles[nm] || null) : null;
    }
    if (typeof v === 'string') return MM.soundFiles[v] || null;
    if (typeof v === 'object' && v.src !== undefined) return v;
    return null;
  }

  /* ===================================================================== */
  /*  GMS 1.4 builtins                                                      */
  /* ===================================================================== */

  // GML 1.4: audio_play_sound(index, priority, loop) -- loop is the 3rd arg.
  B.audio_play_sound = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (!f) return 0;
    var loop = args.length >= 3 ? num(args[2], 0) !== 0 : false;
    MM.audio.playFile(f.name, f.src, {
      loop: loop,
      volume: num(f.volume, 1),
      pitch: f.pitch ? Math.pow(2, f.pitch / 12) : 1
    });
    return 0;
  };

  // Legacy GML 1.4 sound_* builtins go through the file player as well.
  B.sound_play = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (!f) return 0;
    MM.audio.playFile(f.name, f.src, {
      loop: false,
      volume: num(f.volume, 1),
      pitch: f.pitch ? Math.pow(2, f.pitch / 12) : 1
    });
    return 0;
  };

  B.sound_loop = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (!f) return 0;
    MM.audio.stopFile(f.name);   // restart rather than stack copies
    MM.audio.playFile(f.name, f.src, {
      loop: true,
      volume: num(f.volume, 1),
      pitch: f.pitch ? Math.pow(2, f.pitch / 12) : 1
    });
    return 0;
  };

  B.sound_stop = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (f) MM.audio.stopFile(f.name);
    return 0;
  };

  B.sound_is_playing = function (ctx, args) {
    var f = resolveSound(args[0]);
    return !!(f && MM.audio.isFilePlaying(f.name));
  };

  B.audio_stop_sound = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (f) MM.audio.stopFile(f.name);
    return 0;
  };

  B.audio_stop_all = function (ctx, args) {
    MM.audio.stopAllFiles();
    MM.audio.stopAllSfx();
    // GM's audio_stop_all() stops music too; the game relies on it when it
    // switches tracks (audio_stop_all(); audio_play_music(...)).
    MM.audio.stopMusicFile();
    MM.audio.stopMusic();
    return 0;
  };

  B.audio_play_music = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (!f) return 0;
    MM.audio.playMusicFile(f.name, f.src, {
      loop: num(args[1], 1) !== 0,
      volume: num(f.volume, 1),
      pitch: f.pitch ? Math.pow(2, f.pitch / 12) : 1
    });
    return 0;
  };

  B.audio_stop_music = function (ctx, args) {
    MM.audio.stopMusicFile();
    MM.audio.stopMusic();
    return 0;
  };

  B.audio_sound_gain = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (f) MM.audio.setFileVolume(f.name, num(args[1], 1), num(args[2], 0));
    return 0;
  };

  B.audio_music_gain = function (ctx, args) {
    MM.audio.setMusicVolume(num(args[0], 1), num(args[1], 0));
    return 0;
  };

  B.audio_master_gain = function (ctx, args) {
    MM.audio.setMusicVolume(num(args[0], 1), num(args[1], 0));
    return 0;
  };

  B.audio_is_playing = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (!f) return false;
    if (MM.audio.isMusicFilePlaying && MM.audio.isMusicFilePlaying(f.name)) return true;
    return MM.audio.isFilePlaying(f.name) ? true : false;
  };

  B.audio_pause_music = function (ctx, args) { MM.audio.pauseMusicFile(); return 0; };
  B.audio_resume_music = function (ctx, args) { MM.audio.resumeMusicFile(); return 0; };
  B.audio_pause_sound = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (f) MM.audio.stopFile(f.name);
    return 0;
  };
  B.audio_resume_sound = function (ctx, args) {
    var f = resolveSound(args[0]);
    if (f) MM.audio.playFile(f.name, f.src, { loop: f.loop, volume: f.volume });
    return 0;
  };
  B.audio_pause_all = function (ctx, args) { MM.audio.pauseAllFiles(); return 0; };
  B.audio_resume_all = function (ctx, args) { MM.audio.resumeAllFiles(); return 0; };
  B.sound_global_volume = function (ctx, args) {
    MM.audio.setSfxVolume(num(args[0], 1));
    MM.audio.setMusicVolume(num(args[0], 1));
    return 0;
  };

  /* --- saves & files ---------------------------------------------------- */

  var FS_PREFIX = 'nbr_fs_';

  B.game_save = function (ctx, args) {
    try {
      var slot = str(args[0]);
      var payload = { globals: JSON.parse(JSON.stringify(MM.globals || {})) };
      var list = [];
      var insts = MM.state.instances;
      for (var i = 0; i < insts.length; i++) {
        var it = insts[i];
        if (!it.persistent) continue;
        list.push({ o: it.object_name, x: it.x, y: it.y, v: it._userVars ? it._userVars.reduce(function (acc, k) { acc[k] = it[k]; return acc; }, {}) : {} });
      }
      payload.instances = list;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FS_PREFIX + slot, JSON.stringify(payload));
      }
      return 1;
    } catch (e) { return 0; }
  };

  B.game_load = function (ctx, args) {
    try {
      var slot = str(args[0]);
      if (typeof localStorage === 'undefined') return 0;
      var raw = localStorage.getItem(FS_PREFIX + slot);
      if (!raw) return 0;
      var payload = JSON.parse(raw);
      if (payload.globals) {
        MM.globals = payload.globals;
        MM.state.globals = payload.globals;
      }
      if (payload.instances) {
        for (var i = 0; i < payload.instances.length; i++) {
          var d = payload.instances[i];
          var inst = MM.instanceCreate(d.x, d.y, d.o, d.v);
          if (inst) inst.persistent = true;
        }
      }
      return 1;
    } catch (e) { return 0; }
  };

  B.file_exists = function (ctx, args) {
    var name = str(args[0]);
    if (!name) return false;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FS_PREFIX + name) !== null) return true;
    return false;
  };

  B.file_delete = function (ctx, args) {
    var name = str(args[0]);
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(FS_PREFIX + name);
      return 1;
    } catch (e) { return 0; }
  };

  /* --- queries ---------------------------------------------------------- */

  B.collision_point = function (ctx, args) {
    var x = num(args[0]), y = num(args[1]), obj = args[2];
    var notme = num(args[4]);
    var list = MM.query(obj);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (notme && o === ctx.self) continue;
      var box = MM.bbox(o);
      if (box && x >= box.l && x <= box.r && y >= box.t && y <= box.b) return o.id;
    }
    return 0;
  };

  B.position_destroy = function (ctx, args) {
    var x = num(args[0]), y = num(args[1]);
    var list = MM.state.instances.slice();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o._destroyed) continue;
      var box = MM.bbox(o);
      if (box && x >= box.l && x < box.r && y >= box.t && y < box.b) MM.instanceDestroy(o);
    }
    return 0;
  };

  B.instance_activate_object = function (ctx, args) {
    var list = MM.query(args[0]);
    for (var i = 0; i < list.length; i++) list[i]._deactivated = false;
    return 0;
  };

  B.instance_deactivate_object = function (ctx, args) {
    var list = MM.query(args[0]);
    for (var i = 0; i < list.length; i++) list[i]._deactivated = true;
    return 0;
  };

  // PAUSER pauses with instance_deactivate_all(true) and resumes with
  // instance_activate_all().  On pause the ORIGINAL GML then hides the floor
  // background for the dark pause screen, but the resume never restores it --
  // after the first pause the floor/backgrounds were gone forever (the
  // "пола нету" reports).  The runtime snapshots the live background state at
  // deactivate_all and puts it back at activate_all, so pause is completely
  // invisible to the game state.
  var bgPauseSnap = null;

  function bgSnapshot() {
    var S = MM.bg;
    if (!S) return null;
    var keys = ['visible', 'foreground', 'x', 'y', 'hspeed', 'vspeed', 'alpha', 'blend', 'htiled', 'vtiled', 'stretch'];
    var snap = { slots: BG_SLOTS, room: S.room };
    for (var k = 0; k < keys.length; k++) snap[keys[k]] = S[keys[k]].slice();
    return snap;
  }

  B.instance_activate_all = function (ctx, args) {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) list[i]._deactivated = false;
    if (bgPauseSnap && MM.bg) {
      var S = MM.bg, snap = bgPauseSnap, n = Math.min(snap.slots, BG_SLOTS);
      if (S.room === snap.room) {
        var keys = ['visible', 'foreground', 'x', 'y', 'hspeed', 'vspeed', 'alpha', 'blend', 'htiled', 'vtiled', 'stretch'];
        for (var i2 = 0; i2 < n; i2++) for (var k2 = 0; k2 < keys.length; k2++) S[keys[k2]][i2] = snap[keys[k2]][i2];
        S.frame = (MM.state && MM.state.frame) || 0; // do not fast-forward scroll through the pause
      }
      bgPauseSnap = null;
    }
    return 0;
  };

  B.instance_deactivate_all = function (ctx, args) {
    if (MM.bg) bgPauseSnap = bgSnapshot();
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) if (!list[i].persistent) list[i]._deactivated = true;
    return 0;
  };

  B.tile_layer_show = function (ctx, args) { return 0; };
  B.tile_layer_hide = function (ctx, args) { return 0; };

  /* --- paths ------------------------------------------------------------ */

  B.path_start = function (ctx, args) {
    var self = ctx.self;
    var p = args[0];
    if (!self || !p) return 0;
    var path = (typeof p === 'string') ? MM.paths[p] : p;
    if (!path) return 0;
    self._path = { def: path, pos: 0, dir: 1, speed: num(args[1], 1), action: num(args[2], 0), absolute: num(args[3], 0) !== 0 };
    return 0;
  };

  B.path_end = function (ctx, args) {
    var self = args[0] || ctx.self;
    if (self) self._path = null;
    return 0;
  };

  // GMS: mp_linear_step_object(x, y, stepsize, obj)
  // Move the calling instance toward (x, y) by at most `stepsize` pixels,
  // stopping before it would enter any instance of `obj`.
  B.mp_linear_step_object = function (ctx, args) {
    var me = ctx.self;
    if (!me) return 0;
    var tx = num(args[0]), ty = num(args[1]);
    var st = num(args[2], 1);
    var obj = args[3];
    if (!(st > 0)) st = 1;
    var dx = tx - me.x, dy = ty - me.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.0001) return 1;
    var ux = dx / dist, uy = dy / dist;
    var full = Math.min(st, dist);
    var moved = 0;
    while (moved < full) {
      var nx = me.x + ux, ny = me.y + uy;
      if (obj && MM.placeMeeting(me, nx, ny, obj)) break;
      me.x = nx;
      me.y = ny;
      moved += 1;
      if (moved >= dist) return 1;
    }
    return moved >= dist ? 1 : 0;
  };

  /* --- misc ------------------------------------------------------------- */

  B.show_message = function (ctx, args) {
    if (typeof console !== 'undefined') console.log('[show_message] ' + str(args[0]));
    return 0;
  };

  B.game_end = function (ctx, args) {
    if (MM.stop) MM.stop();
    return 0;
  };

  B.window_set_fullscreen = function (ctx, args) {
    try {
      if (num(args[0], 0) !== 0 && MM.canvas && MM.canvas.requestFullscreen) MM.canvas.requestFullscreen();
      else if (document.exitFullscreen) document.exitFullscreen();
    } catch (e) { /* ignore */ }
    return 0;
  };

  B.font_add_sprite = function (ctx, args) {
    // Approximation: every frame of the sprite becomes one glyph.
    var spr = args[0];
    if (!spr) return -1;
    var first = num(args[1], 32), sep = num(args[3], 0);
    var glyphs = [];
    for (var i = 0; i < spr.frames.length; i++) {
      glyphs.push({ ch: String.fromCharCode(first + i), x: 0, y: 0, w: spr.w, h: spr.h, shift: spr.w + sep, offset: 0 });
    }
    var name = 'font_' + spr.name;
    MM.defineFont(name, null, glyphs, { lineHeight: spr.h, emSize: spr.h });
    return name;
  };

  // Colour-tinted copies are rare (one call site), so cache them by image+colour.
  var bgTintCache = {};

  function bgTinted(img, col) {
    try {
      var key = (img.src || '') + '|' + col;
      if (bgTintCache[key]) return bgTintCache[key];
      var cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      var c2 = cv.getContext('2d');
      c2.drawImage(img, 0, 0);
      c2.globalCompositeOperation = 'multiply';
      var n = col | 0;
      c2.fillStyle = 'rgb(' + (n & 255) + ',' + ((n >> 8) & 255) + ',' + ((n >> 16) & 255) + ')';
      c2.fillRect(0, 0, cv.width, cv.height);
      bgTintCache[key] = cv;
      return cv;
    } catch (e) {
      return img;
    }
  }

  // GM signature: draw_background_ext(back, x, y, xscale, yscale, rot, colour, alpha)
  B.draw_background_ext = function (ctx, args) {
    var c = MM.gfxCtx;
    if (!c) return 0;
    var bg = args[0];
    var src = (bg && bg.src) ? bg.src : null;
    if (!src && typeof bg === 'string') src = (MM.bgImages && MM.bgImages[bg]) || null;
    var img = MM.bgImage(src);
    if (!img || !img.width) return 0;
    var x = num(args[1]), y = num(args[2]);
    var sx = num(args[3], 1) || 1, sy = num(args[4], 1) || 1;
    var rot = num(args[5], 0) * Math.PI / 180;
    var col = args.length > 6 ? args[6] : -1;
    var alpha = args.length > 7 ? num(args[7], 1) : 1;
    var drawn = (col !== -1 && col !== 16777215) ? bgTinted(img, col) : img;
    var w = img.width * sx, h = img.height * sy;
    var prev = c.globalAlpha;
    c.globalAlpha = Math.max(0, Math.min(1, prev * alpha));
    if (rot) {
      c.save();
      c.translate(x + w / 2, y + h / 2);
      c.rotate(rot);
      c.drawImage(drawn, -w / 2, -h / 2, w, h);
      c.restore();
    } else {
      c.drawImage(drawn, x, y, w, h);
    }
    c.globalAlpha = prev;
    return 0;
  };

  B.move_snap = function (ctx, args) {
    var self = ctx.self;
    if (!self) return 0;
    var gx = num(args[0], 16), gy = num(args[1], 16);
    self.x = Math.round(self.x / gx) * gx;
    self.y = Math.round(self.y / gy) * gy;
    return 0;
  };

  B.keyboard_key_press = function (ctx, args) {
    // GML injects a key press into the input queue for this step.
    var k = num(args[0], 0);
    MM.input.keys[k] = true;
    MM.input.pressed[k] = true;
    MM.input.anyKeyPressed = true;
    MM.input.lastKey = k;
    return 0;
  };

  B.action_sprite_color = function (ctx, args) { return 0; };
  B.environment_get_variable = function (ctx, args) { return 0; };

  /* ===================================================================== */
  /*  Boot helpers                                                         */
  /* ===================================================================== */


  /* ===================================================================== */
  /*  Resource preloading                                                   */
  /* ===================================================================== */

  // Load one frame and call `cb` exactly once when the image is usable
  // (or has failed).  Several callers can wait on the same frame.
  function ensureFrame(f, cb) {
    if (!f) { if (cb) cb(); return; }
    if (f.img) { if (cb) cb(); return; }
    if (!hasImage) { if (cb) cb(); return; }
    if (!f._waiters) f._waiters = [];
    if (cb) f._waiters.push(cb);
    if (f._tried) return;
    f._tried = true;
    var im = new Image();
    var settle = function () {
      f.img = (im._ok ? im : null);
      var w = f._waiters || [];
      f._waiters = [];
      for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) {} }
    };
    im.onload = function () { im._ok = true; settle(); };
    im.onerror = function () { im._ok = false; settle(); };
    im.src = f.src;
  }

  // Frames of a sprite that are still missing, appended to `out`.
  function collectFrames(def, out, seen) {
    if (!def || def.kind !== 'image' || !def.frames || seen[def.name]) return;
    seen[def.name] = 1;
    for (var i = 0; i < def.frames.length; i++) {
      if (!def.frames[i].img) out.push(def.frames[i]);
    }
  }

  MM.loadFrames = function (frames, onDone, onTick) {
    if (!frames.length) { if (onDone) onDone(); return; }
    var left = frames.length;
    var tick = function () {
      left--;
      if (onTick) onTick(frames.length - left, frames.length);
      if (left <= 0 && onDone) onDone();
    };
    for (var i = 0; i < frames.length; i++) ensureFrame(frames[i], tick);
  };

  // Sprites referenced by the code of every object present in the room.
  function spritesInCode(objs, out, seen) {
    var re = /\bspr[A-Za-z0-9_]+/g;
    for (var on in objs) {
      var def = objs[on];
      if (!def || !def.events) continue;
      for (var ev in def.events) {
        var raw = def.events[ev];
        if (typeof raw !== 'string' || !raw.length) continue;
        var code = MM.resolveCode(raw);
        if (!code || typeof code !== 'string') continue;
        re.lastIndex = 0;
        var m;
        while ((m = re.exec(code))) {
          var spr = MM.sprites && MM.sprites[m[0]];
          if (spr) collectFrames(spr, out, seen);
        }
      }
    }
  }

  MM.roomFrames = function (room) {
    var frames = [], seen = Object.create(null);
    var objs = Object.create(null);
    var list = MM.state ? MM.state.instances : [];
    // the room's own instance list is already live by the time this runs
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it._destroyed) continue;
      collectFrames(it.sprite_index, frames, seen);
      collectFrames(it.mask_index, frames, seen);
      if (it.object_index && it.object_index.maskKind === 'mask' && it.sprite_index && it.sprite_index.mask) {
        MM.preloadMask(it.sprite_index.mask);
      }
      if (it.object_index) objs[it.object_index.name] = it.object_index;
    }
    spritesInCode(objs, frames, seen);
    return frames;
  };

  // Called by MM._loadRoom(): show a short loading screen until the room's
  // sprites are decoded.  Rooms whose sprites are already cached return
  // immediately.
  MM.startRoomPreload = function (room) {
    if (!hasImage || !room) return;
    var frames = MM.roomFrames(room);
    // backgrounds of this room
    var bg = [], bgSeen = Object.create(null);
    for (var i = 0; i < (room.bgLayers || []).length; i++) {
      var L = room.bgLayers[i];
      if (!L || !L.img || bgSeen[L.img]) continue;
      bgSeen[L.img] = 1;
      var im = MM.bgImage(L.img);
      if (im && !im._ready && !im._failed) bg.push(im);
    }
    var pending = frames.length + bg.length;
    if (!pending) { MM.loading = null; return; }
    var L2 = MM.loading = { done: 0, total: pending, room: room.name, started: Date.now() };
    var bump = function () {
      L2.done++;
      if (L2.done >= pending) {
        if (MM.loading === L2) MM.loading = null;
      }
    };
    MM.loadFrames(frames, null, function () { bump(); });
    for (var b = 0; b < bg.length; b++) {
      (function (im) {
        im.addEventListener('load', bump, { once: true });
        im.addEventListener('error', bump, { once: true });
      })(bg[b]);
    }
    // never trap the player behind a broken asset
    if (typeof setTimeout === 'function') {
      setTimeout(function () { if (MM.loading === L2) MM.loading = null; }, 12000);
    }
  };

  // Low priority warm-up of everything else, so later rooms open instantly.
  MM.startBackgroundPreload = function (delay) {
    if (!hasImage || typeof setTimeout !== 'function') return;
    var defs = [];
    for (var n in MM.sprites) {
      var d = MM.sprites[n];
      if (d && d.kind === 'image' && d.frames) defs.push(d);
    }
    var frames = [], seen = Object.create(null);
    for (var i = 0; i < defs.length; i++) collectFrames(defs[i], frames, seen);
    var idx = 0;
    var pump = function () {
      if (!frames.length || idx >= frames.length) return;
      var end = Math.min(frames.length, idx + 16);
      for (; idx < end; idx++) ensureFrame(frames[idx], null);
      setTimeout(pump, 50);
    };
    setTimeout(pump, delay == null ? 1200 : delay);
  };


  // Sounds warmed up right after the audio unlock: the ones the GML calls
  // most often (rings, jumps, hits, alarms, familiar music stings).
  MM.PRELOAD_SOUNDS = [
    'SFX_Ring', 'SFX_Jump', 'SFX_Rolling', 'SFX_Spindash', 'SFX_Spring',
    'SFX_Hit', 'SFX_LoseRings', 'SFX_TrapRing', 'SFX_DataMove', 'SFX_Alert',
    'SFX_Warp', 'SFX_Laugh', 'SFX_GS', 'SFX_ExeHit', 'SFX_BotHit',
    'SFX_BoxBroke', 'SFX_Broke', 'SFX_BlowsUp', 'SFX_Grab', 'SFX_EnergoChin',
    'SFX_BorderWarp', 'SFX_SuperTrapRing', 'SFX_Elevator', 'SFX_GCU',
    'SFX_MSonic_Pulse', 'SFX_MiniSunsetHill', 'SFX_YCR_Piano3', 'SFX_Continue',
    'SFX_Locked', 'SFX_TTP', 'SFX_DataSelect', 'SFX_SEGA', 'SFX_TitleScreen',
    'SFX_GreenHill', 'SFX_Hill', 'SFX_Forest', 'SFX_HS1', 'SFX_Chase1',
    'SFX_Cont', 'SFX_GU'
  ];


  /* --------------------------------------------------------------------- */
  /*  Full preload: everything the game owns, before the first frame        */
  /* --------------------------------------------------------------------- */

  var preloadQueue = null;    // onDone callbacks while a run is in progress
  var preloadGuardMs = 30000;

  function collectPreloadJobs() {
    var jobs = [], seen = Object.create(null), n, d, i, f;

    // 1. every sprite frame
    for (n in MM.sprites) {
      d = MM.sprites[n];
      if (!d || d.kind !== 'image' || !d.frames) continue;
      for (i = 0; i < d.frames.length; i++) {
        f = d.frames[i];
        if (!f || f.img || !f.src || seen['f' + f.src]) continue;
        seen['f' + f.src] = 1;
        jobs.push({ kind: 'img', src: f.src, obj: f });
      }
    }

    // 2. every pixel mask (heroes and anything with maskKind "mask")
    for (n in MM.sprites) {
      d = MM.sprites[n];
      if (!d || !d.mask || seen['m' + d.mask]) continue;
      seen['m' + d.mask] = 1;
      jobs.push({ kind: 'mask', src: d.mask });
    }

    // 3. backgrounds
    for (n in MM.bgImages) {
      var url = MM.bgImages[n];
      if (url && url.src) url = url.src;
      if (!url || seen['b' + url]) continue;
      seen['b' + url] = 1;
      jobs.push({ kind: 'bg', src: url });
    }

    // 4. audio: bytes only, decoded on first play
    var sounds = MM.soundFiles || {};
    for (n in sounds) {
      var def = sounds[n];
      if (!def || !def.src || seen['s' + def.src]) continue;
      seen['s' + def.src] = 1;
      jobs.push({ kind: 'snd', src: def.src });
    }

    return jobs;
  }

  MM.preloadAll = function (opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var onDone = opts.onDone || function () {};

    if (MM.preloadedAll) { onDone({ skipped: true }); return; }
    if (preloadQueue) { preloadQueue.push(onDone); return; }
    preloadQueue = [onDone];
    MM.preloadAllUsed = true;

    if (!hasImage) {           // node / headless: nothing to fetch
      MM.preloadedAll = true;
      var q0 = preloadQueue; preloadQueue = null;
      for (var z = 0; z < q0.length; z++) q0[z]({ skipped: true });
      return;
    }

    var jobs = collectPreloadJobs();
    var total = jobs.length;
    var width = Math.max(1, Math.min(8, opts.concurrency || 8));
    var next = 0, done = 0, failed = 0, finishedFlag = false;

    MM.preloadStats = { done: 0, total: total, failed: 0, finished: false };
    onProgress({ done: 0, total: total, failed: 0 });

    function finish() {
      if (finishedFlag) return;
      finishedFlag = true;
      MM.preloadedAll = true;
      MM.preloadStats.finished = true;
      var list = preloadQueue || [];
      preloadQueue = null;
      onProgress({ done: total, total: total, failed: failed, finished: true });
      for (var i = 0; i < list.length; i++) { try { list[i]({ total: total, failed: failed }); } catch (e) {} }
    }

    function tick(ok) {
      done++;
      if (!ok) failed++;
      MM.preloadStats.done = done;
      MM.preloadStats.failed = failed;
      if ((done & 7) === 0 || done >= total) {
        onProgress({ done: done, total: total, failed: failed });
      }
      if (done >= total) finish();
    }

    function run(job, doneCb) {
      var settled = false;
      var guard = null;
      var once = function (ok) {
        if (settled) return;
        settled = true;
        if (guard && typeof clearTimeout === 'function') clearTimeout(guard);
        doneCb(ok);
      };
      if (typeof setTimeout === 'function') {
        guard = setTimeout(function () { once(false); }, preloadGuardMs);
      }
      try {
        if (job.kind === 'img') {
          ensureFrame(job.obj, function () { once(!!job.obj.img); });
        } else if (job.kind === 'mask') {
          maskData(job.src, function (ok) { once(ok); });
        } else if (job.kind === 'bg') {
          var im = MM.bgImage(job.src);
          if (!im || im._ready) once(true);
          else {
            im.addEventListener('load', function () { once(true); });
            im.addEventListener('error', function () { once(false); });
          }
        } else if (job.kind === 'snd') {
          if (MM.audio && MM.audio.prefetchFile) MM.audio.prefetchFile(job.src, function (ok) { once(ok); });
          else once(true);
        } else {
          once(true);
        }
      } catch (e) { once(false); }
    }

    function pump() {
      if (next >= total) return;
      var job = jobs[next++];
      run(job, function (ok) {
        tick(ok);
        if (done < total) {
          // let the browser paint between items
          if (typeof setTimeout === 'function') setTimeout(pump, 0);
          else pump();
        }
      });
    }

    for (var w = 0; w < width; w++) pump();
  };

  MM.nbrBoot = function (opts) {
    opts = opts || {};
    MM.VIEW_W = opts.width || 640;
    MM.VIEW_H = opts.height || 480;
    MM.FPS = opts.fps || 60;
    MM.boot({
      canvas: opts.canvas,
      width: MM.VIEW_W,
      height: MM.VIEW_H,
      room: opts.room || 'LanguageSelect_19',
      autostart: opts.autostart !== false
    });
    // With the full preload running (index.html) the background warmer would
    // only duplicate work; it stays as a fallback for bare test pages.
    if (!MM.preloadAllUsed && MM.startBackgroundPreload) MM.startBackgroundPreload(1500);
    return MM;
  };

})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
  : typeof window !== 'undefined' ? window
  : this);
