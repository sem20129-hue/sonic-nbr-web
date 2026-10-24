// =====================================================================
// MiniMaker — mm_core.js
// Ядро движка: ресурсы (спрайты/объекты/комнаты), инстансы, события,
// столкновения, физика, камера, ввод, эффекты, отрисовка, жизненный цикл.
// Классический скрипт (без модулей). Всё живёт в глобальном объекте MM.
// =====================================================================
(function () {
  'use strict';

  var MM = (globalThis.MM = globalThis.MM || {});

  MM.VERSION = '1.0.0';
  MM.sprites = MM.sprites || {};
  MM.objects = MM.objects || {};
  MM.rooms = MM.rooms || {};
  MM.scripts = MM.scripts || {};
  MM.sounds = MM.sounds || {};
  MM.musics = MM.musics || {};
  MM.warnings = MM.warnings || [];

  MM.VIEW_W = 480;
  MM.VIEW_H = 270;
  MM.FPS = 60;

  // Специальные значения как в Game Maker
  MM.SELF = -1;
  MM.OTHER = -2;
  MM.ALL = -3;
  MM.NOONE = -4;

  MM.warn = function (msg) {
    var m = String(msg);
    MM.warnings.push(m);
    if (MM.logWarnings !== false && typeof console !== 'undefined' && console.warn) {
      console.warn('[MM] ' + m);
    }
  };

  // -------------------------------------------------------------------
  // Глобальное состояние
  // -------------------------------------------------------------------
  MM.state = {
    running: false,
    room: null,
    instances: [],
    nextId: 1,
    globals: {},
    frame: 0,
    frameInRoom: 0,
    pendingRoom: null,
    paused: false,
    version: 0,           // растёт при изменении списка инстансов
    destroyedQueue: [],
    bootRoom: 'rTitle'
  };
  MM.globals = MM.state.globals;

  // Камера/виды (как view_xview[0] и т. п. в GM)
  MM.view = {
    visible: [false, false, false, false, false, false, false, false],
    object: [null, null, null, null, null, null, null, null],
    xview: [0, 0, 0, 0, 0, 0, 0, 0],
    yview: [0, 0, 0, 0, 0, 0, 0, 0],
    wview: [480, 480, 480, 480, 480, 480, 480, 480],
    hview: [270, 270, 270, 270, 270, 270, 270, 270],
    hborder: [64, 64, 64, 64, 64, 64, 64, 64],
    vborder: [48, 48, 48, 48, 48, 48, 48, 48],
    hspeed: [-1, -1, -1, -1, -1, -1, -1, -1],
    vspeed: [-1, -1, -1, -1, -1, -1, -1, -1],
    portX: [0, 0, 0, 0, 0, 0, 0, 0],
    portY: [0, 0, 0, 0, 0, 0, 0, 0],
    portW: [640, 640, 640, 640, 640, 640, 640, 640],
    portH: [480, 480, 480, 480, 480, 480, 480, 480]
  };

  // Первый включённый вид -- именно он попадает на экран.
  MM.activeView = function () {
    var idx = 0, found = false;
    for (var i = 0; i < 8; i++) {
      if (MM.view.visible[i]) { idx = i; found = true; break; }
    }
    if (!found) idx = 0;
    var vw = MM.view.wview[idx] || MM.VIEW_W;
    var vh = MM.view.hview[idx] || MM.VIEW_H;
    var pw = MM.view.portW[idx] || MM.VIEW_W;
    var ph = MM.view.portH[idx] || MM.VIEW_H;
    return {
      index: idx,
      x: MM.view.xview[idx] || 0,
      y: MM.view.yview[idx] || 0,
      w: vw, h: vh,
      px: MM.view.portX[idx] || 0,
      py: MM.view.portY[idx] || 0,
      pw: pw, ph: ph,
      sx: pw / vw,
      sy: ph / vh
    };
  };

  // Игровые эффекты
  MM.fx = {
    shakePower: 0, shakeFrames: 0,
    flashColor: '#ffffff', flashAlpha: 0, flashDecay: 0,
    overlayColor: '#000000', overlayAlpha: 0,
    scanlines: 0,
    shakeX: 0, shakeY: 0
  };
  MM.fxShake = function (power, frames) { MM.fx.shakePower = power; MM.fx.shakeFrames = frames || 12; };
  MM.fxFlash = function (hex, frames, alpha) {
    MM.fx.flashColor = hex || '#ffffff';
    MM.fx.flashAlpha = alpha == null ? 1 : alpha;
    MM.fx.flashDecay = MM.fx.flashAlpha / Math.max(1, frames || 10);
  };
  MM.fxOverlay = function (hex, alpha) { MM.fx.overlayColor = hex || '#000000'; MM.fx.overlayAlpha = alpha; };
  MM.fxScanlines = function (a) { MM.fx.scanlines = a; };

  // -------------------------------------------------------------------
  // Ресурсы: спрайты
  // -------------------------------------------------------------------
  function hexToRgb(hex) {
    if (typeof hex !== 'string') return null;
    if (hex[0] !== '#') return null;
    var h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  MM.sprite = function (def) {
    if (!def || !def.name) { MM.warn('MM.sprite: нет имени'); return null; }
    if (!def.frames || !def.frames.length) { MM.warn('спрайт ' + def.name + ': нет кадров'); return null; }
    def.w = def.w || String(def.frames[0][0] || '').length;
    def.h = def.h || def.frames[0].length;
    def.origin = def.origin || [0.5, 0.5];
    def.palette = Object.assign({ '.': null, ' ': null }, MM.palette || {}, def.palette || {});

    // Проверка кадров + вычисление плотной рамки (bbox)
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, hasPixels = false;
    for (var f = 0; f < def.frames.length; f++) {
      var rows = def.frames[f];
      if (rows.length !== def.h) {
        MM.warn('спрайт ' + def.name + ': кадр ' + f + ' имеет ' + rows.length + ' строк вместо ' + def.h);
      }
      for (var y = 0; y < rows.length; y++) {
        var row = rows[y];
        if (row.length !== def.w) {
          MM.warn('спрайт ' + def.name + ': кадр ' + f + ', строка ' + y + ' длиной ' + row.length + ' вместо ' + def.w);
        }
        for (var x = 0; x < row.length; x++) {
          var ch = row[x];
          var col = def.palette[ch];
          if (col === undefined) {
            MM.warn('спрайт ' + def.name + ': неизвестный цвет "' + ch + '"');
            def.palette[ch] = null;
            col = null;
          }
          if (col !== null && col !== undefined) {
            hasPixels = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
    var ox = def.origin[0] * def.w;
    var oy = def.origin[1] * def.h;
    if (hasPixels) {
      def.bbox = { l: minX - ox, t: minY - oy, r: maxX + 1 - ox, b: maxY + 1 - oy };
    } else {
      def.bbox = null;
    }
    def._canvases = [];
    def._tints = {};
    MM.sprites[def.name] = def;
    return def;
  };

  function buildSpriteCanvas(spr, frameIdx) {
    if (spr.kind === 'image') return MM.imageFrame ? MM.imageFrame(spr, frameIdx) : null;
    if (spr._canvases[frameIdx]) return spr._canvases[frameIdx];
    if (typeof document === 'undefined' || !document.createElement) { spr._canvases[frameIdx] = null; return null; }
    var cv = document.createElement('canvas');
    cv.width = spr.w; cv.height = spr.h;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(spr.w, spr.h);
    var data = img.data;
    var rows = spr.frames[frameIdx];
    for (var y = 0; y < spr.h; y++) {
      var row = rows[y] || '';
      for (var x = 0; x < spr.w; x++) {
        var ch = row[x];
        var col = spr.palette[ch];
        if (col === undefined || col === null) continue;
        var rgb = hexToRgb(col);
        if (!rgb) continue;
        var i = (y * spr.w + x) * 4;
        data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    spr._canvases[frameIdx] = cv;
    return cv;
  }
  MM.spriteCanvas = buildSpriteCanvas;

  MM.spriteTinted = function (spr, frameIdx, hex) {
    var key = frameIdx + '|' + hex;
    if (spr._tints[key]) return spr._tints[key];
    var base = buildSpriteCanvas(spr, frameIdx);
    if (!base || typeof document === 'undefined') return base;
    var cv = document.createElement('canvas');
    cv.width = spr.w; cv.height = spr.h;
    var ctx = cv.getContext('2d');
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, spr.w, spr.h);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base, 0, 0);
    spr._tints[key] = cv;
    return cv;
  };

  // -------------------------------------------------------------------
  // Ресурсы: объекты, скрипты, комнаты
  // -------------------------------------------------------------------
  MM.object = function (def) {
    if (!def || !def.name) { MM.warn('MM.object: нет имени'); return null; }
    def.events = def.events || {};
    def.depth = def.depth || 0;
    def.__objDef = true;
    MM.objects[def.name] = def;
    return def;
  };

  MM.script = function (name, code) {
    MM.scripts[name] = MM.resolveCode ? MM.resolveCode(code) : code;
    return MM.scripts[name];
  };

  function expandMap(def) {
    var legend = def.legend || {};
    var tile = def.tileSize || 16;
    var rows = def.map;
    var offX = (def.mapOffset && def.mapOffset[0]) || 0;
    var offY = (def.mapOffset && def.mapOffset[1]) || 0;
    var baseY = def.h - rows.length * tile + offY;
    var out = [];
    for (var y = 0; y < rows.length; y++) {
      var row = rows[y];
      for (var x = 0; x < row.length; x++) {
        var ch = row[x];
        if (ch === ' ' || ch === '.') continue;
        var ent = legend[ch];
        if (!ent) { MM.warn('комната ' + def.name + ': неизвестный символ карты "' + ch + '"'); continue; }
        var spec;
        if (typeof ent === 'string') spec = { obj: ent };
        else spec = { obj: ent.obj, vars: ent.vars, spr: ent.spr, extra: ent.extra };
        var entry = { obj: spec.obj, x: offX + x * tile, y: baseY + y * tile };
        var vars = Object.assign({}, spec.vars || {});
        if (spec.spr) vars.sprite_index = spec.spr;
        if (Object.keys(vars).length) entry.vars = vars;
        if (spec.extra) Object.assign(entry, spec.extra);
        out.push(entry);
      }
    }
    def.instances = out.concat(def.instances || []);
  }

  MM.room = function (def) {
    if (!def || !def.name) { MM.warn('MM.room: нет имени'); return null; }
    def.w = def.w || MM.VIEW_W;
    def.h = def.h || MM.VIEW_H;
    def.bgColor = def.bgColor || '#000000';
    def.instances = (def.instances || []).slice();
    if (def.map) expandMap(def);
    // В GML имя комнаты — это её id, и `room == GHZ_7` сравнивает именно id.
    // valueOf позволяет сравнивать def и с объектом, и со строкой имени.
    def.valueOf = function () { return def.name; };
    def.toString = function () { return def.name; };
    MM.rooms[def.name] = def;
    return def;
  };

  // -------------------------------------------------------------------
  // Инстансы
  // -------------------------------------------------------------------
  function resolveRef(ref, table, what) {
    if (ref == null) return null;
    if (typeof ref === 'string') {
      var r = table[ref];
      if (!r) MM.warn('Не найден ' + what + ' "' + ref + '"');
      return r || null;
    }
    return ref;
  }
  MM.resolveSprite = function (r) { return resolveRef(r, MM.sprites, 'спрайт'); };
  MM.resolveObject = function (r) { return resolveRef(r, MM.objects, 'объект'); };
  MM.resolveRoom = function (r) { return resolveRef(r, MM.rooms, 'комната'); };

  // GML resource ids are plain numbers: decompiled code can carry raw ids
  // (Sonic's draw picks sprp = 0/1/2..., and 117 is a music track), so numeric
  // references must resolve through the original asset order as well.
  var _resolveSpriteById = MM.resolveSprite;
  MM.resolveSprite = function (r) {
    if (typeof r === 'number') {
      var sn = (r >= 0 && MM.spriteOrder) ? MM.spriteOrder[Math.floor(r)] : null;
      return (sn && MM.sprites[sn]) || null;
    }
    return _resolveSpriteById(r);
  };
  var _resolveObjectById = MM.resolveObject;
  MM.resolveObject = function (r) {
    if (typeof r === 'number') {
      var on = (r >= 0 && MM.objectOrder) ? MM.objectOrder[Math.floor(r)] : null;
      return (on && MM.objects[on]) || null;
    }
    return _resolveObjectById(r);
  };

  function Instance(def, x, y, vars) {
    this.id = MM.state.nextId++;
    this.object_index = def;
    this.object_name = def.name;
    this.x = x; this.y = y;
    this.hspeed = 0; this.vspeed = 0;
    this.gravity = 0; this.gravity_direction = 270; this.friction = 0;
    this.sprite_index = resolveRef(def.sprite, MM.sprites, 'спрайт');
    this.mask_index = null;   // GML: null = use the sprite's own mask
    this.image_index = 0; this.image_speed = 1;
    this.image_angle = 0; this.image_xscale = 1; this.image_yscale = 1;
    this.image_alpha = 1; this.image_blend = '#ffffff';
    this.depth = def.depth || 0;
    this.visible = def.visible !== false;
    this.solid = !!def.solid;
    this.persistent = !!def.persistent;
    this.alarm = [];
    for (var i = 0; i < 12; i++) this.alarm[i] = -1;
    this._destroyed = false;
    this._removed = false;
    this._userVars = [];
    if (vars) {
      for (var k in vars) {
        if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
        var v = vars[k];
        if (k === 'sprite_index') v = resolveRef(v, MM.sprites, 'спрайт');
        this[k] = v;
        this._userVars.push(k);
      }
    }
  }
  Object.defineProperty(Instance.prototype, 'speed', {
    get: function () { return Math.sqrt(this.hspeed * this.hspeed + this.vspeed * this.vspeed); },
    set: function (v) {
      var d = this.direction;
      this.hspeed = v * Math.cos(d * Math.PI / 180);
      this.vspeed = -v * Math.sin(d * Math.PI / 180);
    }
  });
  Object.defineProperty(Instance.prototype, 'direction', {
    get: function () {
      if (this.hspeed === 0 && this.vspeed === 0) return 0;
      var d = Math.atan2(-this.vspeed, this.hspeed) * 180 / Math.PI;
      if (d < 0) d += 360;
      return d;
    },
    set: function (d) {
      var s = this.speed;
      this.hspeed = s * Math.cos(d * Math.PI / 180);
      this.vspeed = -s * Math.sin(d * Math.PI / 180);
    }
  });
  // GML reads `obj.bbox_top` & co. through the member accessor, which looks the
  // name up on the instance itself.  Without these getters every cross-instance
  // bbox read silently produced 0 (the Metal Shield ball bounce relied on it).
  var BBOX_SIDES = [["left", "l"], ["right", "r"], ["top", "t"], ["bottom", "b"]];
  for (var _bs = 0; _bs < BBOX_SIDES.length; _bs++) {
    (function (side, key) {
      Object.defineProperty(Instance.prototype, "bbox_" + side, {
        get: function () {
          var b = MM.bbox ? MM.bbox(this) : null;
          return b ? b[key] : 0;
        },
        set: function () { /* read-only in GMS */ },
        configurable: true,
        enumerable: false,
      });
    })(BBOX_SIDES[_bs][0], BBOX_SIDES[_bs][1]);
  }

  MM.Instance = Instance;

  MM.instanceCreate = function (x, y, objRef, vars, deferCreate) {
    var def = MM.resolveObject(objRef);
    if (!def) return null;
    var inst = new Instance(def, x, y, vars);
    MM.state.instances.push(inst);
    MM.state.version++;
    if (!deferCreate) MM.runEvent(inst, 'create');
    return inst;
  };

  MM.instanceDestroy = function (inst) {
    if (!inst || inst._destroyed) return;
    inst._destroyed = true;
    MM.state.version++;
  };

  MM.runEvent = function (inst, evName, other) {
    if (inst && inst._deactivated && evName !== 'create' && evName !== 'destroy') return undefined;
    var code = MM.eventCode(inst.object_index, evName);
    if (!code) return undefined;
    if (!MM.interp) return undefined;
    return MM.interp.run(code, {
      self: inst,
      other: other == null ? MM.NOONE : other,
      name: inst.object_name + ':' + evName
    });
  };

  MM.resolveCode = function (code) {
    if (typeof code !== 'string') return code;
    if (code.charAt(0) !== '@') return code;
    var key = code.slice(1);
    return (MM.codeBundle && MM.codeBundle[key] !== undefined) ? MM.codeBundle[key] : '';
  };

  var EV_ALIAS = {
    begin_step: 'step_1', end_step: 'step_2',
    room_start: 'other_room_start', room_end: 'other_room_end',
    game_start: 'other_game_start', game_end: 'other_game_end'
  };

  MM.eventCode = function (def, evName) {
    var alias = EV_ALIAS[evName];
    var d = def;
    while (d) {
      if (d.events && typeof d.events[evName] === 'string' && d.events[evName].length) return MM.resolveCode(d.events[evName]);
      if (alias && d.events && typeof d.events[alias] === 'string' && d.events[alias].length) return MM.resolveCode(d.events[alias]);
      d = d.parent ? MM.resolveObject(d.parent) : null;
    }
    return null;
  };

  // -------------------------------------------------------------------
  // Запросы и столкновения
  // -------------------------------------------------------------------
  MM.objectChainHas = function (def, target) {
    var d = def;
    while (d) {
      if (d === target) return true;
      d = d.parent ? MM.resolveObject(d.parent) : null;
    }
    return false;
  };

  MM.EMPTY_LIST = MM.EMPTY_LIST || [];

  function buildQueryCache() {
    var st = MM.state;
    if (st._listCache && st._listCacheVersion === st.version) return st._listCache;
    var byObj = {};
    for (var inst of st.instances) {
      if (inst._destroyed || inst._deactivated) continue;
      var d = inst.object_index;
      while (d) {
        var bucket = byObj[d.name] || (byObj[d.name] = []);
        bucket.push(inst);
        d = d.parent ? MM.resolveObject(d.parent) : null;
      }
    }
    st._listCache = byObj;
    st._listCacheVersion = st.version;
    return byObj;
  }

  // objValue: объект-определение | имя | инстанс | число (id) | MM.ALL
  MM.query = function (objValue) {
    if (objValue === MM.ALL || objValue === null || objValue === undefined) {
      return MM.state.instances.filter(function (i) { return !i._destroyed; });
    }
    if (typeof objValue === 'object' && objValue instanceof Instance) {
      return objValue._destroyed ? [] : [objValue];
    }
    if (typeof objValue === 'number') {
      var found = MM.state.instances.filter(function (i) { return i.id === objValue && !i._destroyed; });
      if (found.length) return found;
      // отрицательные спец-числа
      if (objValue === MM.ALL) return MM.query(MM.ALL);
      return [];
    }
    var def = typeof objValue === 'string' ? MM.objects[objValue] : objValue;
    if (!def) return [];
    var cache = buildQueryCache();
    return cache[def.name] || MM.EMPTY_LIST;
  };
  MM.instanceById = function (id) {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  // bbox инстанса в мировых координатах (учитывается спрайт, mask или def.mask)
  // Local-space bbox of a sprite, scaled by the instance transform.
  function bboxOfSprite(inst, spr) {
    var b = spr.bbox;
    if (!b) return null;
    var sx = inst.image_xscale, sy = inst.image_yscale;
    if (sx === 1 && sy === 1) return { l: b.l, r: b.r, t: b.t, b: b.b };
    var l1 = b.l * sx, r1 = b.r * sx, t1 = b.t * sy, b1 = b.b * sy;
    return {
      l: Math.min(l1, r1), r: Math.max(l1, r1),
      t: Math.min(t1, b1), b: Math.max(t1, b1)
    };
  }

  // -------------------------------------------------------------------
  // GM motion model: hspeed/vspeed are the state; speed/direction are
  // derived views over them.  Setting either of them rewrites hspeed/vspeed,
  // exactly like GameMaker.  Without this move_towards_point() changed two
  // dead properties and nothing in the game ever moved along its direction.
  MM.motionSpeed = function (inst) {
    var h = +inst.hspeed || 0, v = +inst.vspeed || 0;
    return Math.sqrt(h * h + v * v);
  };
  MM.motionDirection = function (inst) {
    var h = +inst.hspeed || 0, v = +inst.vspeed || 0;
    if (h === 0 && v === 0) return 0;
    var d = Math.atan2(-v, h) * 180 / Math.PI;
    return d < 0 ? d + 360 : d;
  };
  MM.motionSetSpeed = function (inst, s, dir) {
    s = +s || 0;
    if (s === 0) { inst.hspeed = 0; inst.vspeed = 0; return; }
    var d = (dir === undefined || dir === null)
      ? (MM.motionSpeed(inst) > 1e-9 ? MM.motionDirection(inst) : 0)
      : (+dir || 0);
    var r = d * Math.PI / 180;
    inst.hspeed = Math.cos(r) * s;
    inst.vspeed = -Math.sin(r) * s;
  };
  MM.motionSetDirection = function (inst, d) {
    var s = MM.motionSpeed(inst);
    var r = (+d || 0) * Math.PI / 180;
    inst.hspeed = Math.cos(r) * s;
    inst.vspeed = -Math.sin(r) * s;
  };
  MM.motionSet = function (inst, dir, s) {
    var r = (+dir || 0) * Math.PI / 180;
    inst.hspeed = Math.cos(r) * (+s || 0);
    inst.vspeed = -Math.sin(r) * (+s || 0);
  };
  MM.motionAdd = function (inst, dir, s) {
    var r = (+dir || 0) * Math.PI / 180;
    inst.hspeed = (+inst.hspeed || 0) + Math.cos(r) * (+s || 0);
    inst.vspeed = (+inst.vspeed || 0) - Math.sin(r) * (+s || 0);
  };

  // bbox an instance in world space.
  // Hot path: collision builtins call this hundreds of thousands of times per
  // frame.  Static scenery never moves, so the world bbox is cached on the
  // instance and only recomputed when x / y / scale / sprite change.
  MM.bbox = function (inst, x, y) {
    var own = (x === undefined && y === undefined);
    if (own) {
      var bc = inst._bboxCache;
      if (bc && bc.x === inst.x && bc.y === inst.y &&
          bc.sx === inst.image_xscale && bc.sy === inst.image_yscale &&
          bc.spr === inst.sprite_index && bc.msk === inst.mask_index) return bc.box;
      x = inst.x; y = inst.y;
    } else {
      if (x === undefined) x = inst.x;
      if (y === undefined) y = inst.y;
    }
    // GML: the collision mask is mask_index when it points at a sprite; the
    // game switches it per state (Knuckles stand/duck/punch, ground blocks
    // solid vs one-way "unsolid" strips).  Ignoring it made every block a full
    // 256x256 wall and every character wedged and unable to move.
    var msk = inst.mask_index;
    var maskSpr = (msk && typeof msk === 'object' && msk.bbox) ? msk : null;
    var useSpr = maskSpr || inst.sprite_index;
    var box = (useSpr && useSpr.bbox) ? bboxOfSprite(inst, useSpr) : null;
    if (!box) {
      var m = inst.mask || inst.object_index.mask;
      if (m) {
        var mw = m.w || 16, mh = m.h || 16;
        var mox = (m.ox == null ? 0.5 : m.ox), moy = (m.oy == null ? 0.5 : m.oy);
        box = { l: -mox * mw, r: mw - mox * mw, t: -moy * mh, b: mh - moy * mh };
      }
    }
    if (!box) {
      if (own) inst._bboxCache = { x: inst.x, y: inst.y, sx: inst.image_xscale, sy: inst.image_yscale, spr: inst.sprite_index, msk: inst.mask_index, box: null };
      return null;
    }
    var out = {
      l: Math.floor(x + box.l), r: Math.floor(x + box.r),
      t: Math.floor(y + box.t), b: Math.floor(y + box.b)
    };
    if (own) inst._bboxCache = { x: inst.x, y: inst.y, sx: inst.image_xscale, sy: inst.image_yscale, spr: inst.sprite_index, msk: inst.mask_index, box: out };
    return out;
  };

  // GML bbox_right/bbox_bottom — включительно: касание краями считается столкновением.
  // Two masks only collide when they actually share pixels: an instance whose
  // last row equals the other's first row is *adjacent*, not overlapping.
  // Inclusive comparison here made the player 1px "inside" the floor after a
  // landing, and the floor then blocked every horizontal step (the "stops and
  // can only move after a jump" bug).
  function boxesOverlap(a, b) {
    return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  }


  // Iterate every instance of `def` whose bbox overlaps `box`.  Large static
  // buckets go through the sorted x index; moving instances live in `dyn`.
  // `cb(inst, bbox)` may return true to stop early.
  function eachOverlapping(def, list, box, cb) {
    var l = box.l, r = box.r, t = box.t, b = box.b;
    if (!def || !def.name || list.length < 48) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o._destroyed) continue;
        var ob = MM.bbox(o);
        if (!ob || ob.l >= r || ob.r <= l || ob.t >= b || ob.b <= t) continue;
        if (cb(o, ob)) return true;
      }
      return false;
    }
    var rec = xIndexFor(def, list);
    var es = rec.entries;
    var lo = 0, hi = es.length, from = l - rec.w;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (es[mid].l < from) lo = mid + 1; else hi = mid;
    }
    for (var j = lo; j < es.length; j++) {
      var e = es[j];
      if (e.l >= r) break;
      if (e.r <= l || e.t >= b || e.b <= t) continue;
      if (e.o._destroyed) continue;
      if (cb(e.o, e)) return true;
    }
    for (var k = 0; k < rec.dyn.length; k++) {
      var d = rec.dyn[k];
      if (d._destroyed) continue;
      var db = MM.bbox(d);
      if (!db || db.l >= r || db.r <= l || db.t >= b || db.b <= t) continue;
      if (cb(d, db)) return true;
    }
    return false;
  }

  MM.placeMeeting = function (inst, x, y, objValue, notme) {
    var who = inst instanceof Instance ? inst : MM.state.currentSelf;
    var selfBox = MM.bbox(who, x, y);
    if (!selfBox) return false;
    var list = MM.query(objValue);
    var def = typeof objValue === 'string' ? MM.objects[objValue] : objValue;
    return eachOverlapping(def, list, selfBox, function (o) {
      if (notme !== false && o === who) return false;
      return true;
    });
  };

  MM.instancePlace = function (inst, x, y, objValue) {
    var who = inst instanceof Instance ? inst : MM.state.currentSelf;
    var selfBox = MM.bbox(who, x, y);
    if (!selfBox) return MM.NOONE;
    var list = MM.query(objValue);
    var def = typeof objValue === 'string' ? MM.objects[objValue] : objValue;
    var found = MM.NOONE;
    eachOverlapping(def, list, selfBox, function (o) {
      if (o === who) return false;
      found = o;
      return true;
    });
    return found;
  };

  // --- static x index for large collision buckets ---------------------
  // Level geometry is static; scanning 877 Solid_Mask instances for every
  // zero-width ground probe is what killed the frame rate.  Buckets are
  // rebuilt once per (frame, version) and keep moving instances in a small
  // separate list.
  var _xIndex = {};

  function xIndexFor(def, list) {
    var st = MM.state;
    var rec = _xIndex[def.name];
    // `speed` / `direction` are prototype getters (sqrt + atan2); both are
    // derived from hspeed / vspeed, so testing those two is equivalent.
    if (rec && rec.frame === st.frame && rec.version === st.version) return rec;
    var entries = [];
    var dyn = [];
    var w = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o._destroyed) continue;
      if (o.hspeed || o.vspeed || o.gravity) { dyn.push(o); continue; }
      var b = MM.bbox(o);
      if (!b) continue;
      entries.push({ o: o, l: b.l, r: b.r, t: b.t, b: b.b });
      var ww = b.r - b.l;
      if (ww > w) w = ww;
    }
    entries.sort(function (a, b) { return a.l - b.l; });
    rec = { frame: st.frame, version: st.version, entries: entries, dyn: dyn, w: w };
    _xIndex[def.name] = rec;
    return rec;
  }

  MM.collisionRectangle = function (x1, y1, x2, y2, objValue, notme) {
    var l = Math.min(x1, x2), r = Math.max(x1, x2);
    var t = Math.min(y1, y2), b = Math.max(y1, y2);
    var def = typeof objValue === 'string' ? MM.objects[objValue] : objValue;
    var list = MM.query(def || objValue);
    var self = MM.state.currentSelf;
    if (!def || !def.name || list.length < 48) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (notme && o === self) continue;
        var ob = MM.bbox(o);
        if (ob && ob.l <= r && ob.r >= l && ob.t <= b && ob.b >= t) return o;
      }
      return MM.NOONE;
    }
    var rec = xIndexFor(def, list);
    var es = rec.entries;
    var lo = 0, hi = es.length, from = l - rec.w;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (es[mid].l < from) lo = mid + 1; else hi = mid;
    }
    for (var j = lo; j < es.length; j++) {
      var e = es[j];
      if (e.l > r) break;
      if (e.r < l || e.t > b || e.b < t) continue;
      var io = e.o;
      if (io._destroyed) continue;
      if (notme && io === self) continue;
      return io;
    }
    for (var k = 0; k < rec.dyn.length; k++) {
      var d = rec.dyn[k];
      if (d._destroyed) continue;
      if (notme && d === self) continue;
      var db = MM.bbox(d);
      if (db && db.l <= r && db.r >= l && db.t <= b && db.b >= t) return d;
    }
    return MM.NOONE;
  };

  MM.distanceToObject = function (inst, objValue) {
    var best = 1e18;
    var mine = MM.bbox(inst);
    var list = MM.query(objValue);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === inst) continue;
      var ob = MM.bbox(o);
      var dx, dy;
      if (!mine || !ob) {
        dx = o.x - inst.x; dy = o.y - inst.y;
      } else {
        // GM: distance between the two bounding boxes, 0 when they touch.
        dx = mine.r < ob.l ? ob.l - mine.r : (ob.r < mine.l ? mine.l - ob.r : 0);
        dy = mine.b < ob.t ? ob.t - mine.b : (ob.b < mine.t ? mine.t - ob.b : 0);
      }
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
    return best === 1e18 ? 100000 : best;
  };

  // -------------------------------------------------------------------
  // Шаг мира
  // -------------------------------------------------------------------
  function tickAlarms() {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed) continue;
      for (var a = 0; a < 12; a++) {
        var v = inst.alarm[a];
        if (v > 0) {
          v--;
          inst.alarm[a] = v;
          if (v === 0) {
            inst.alarm[a] = -1;
            MM.runEvent(inst, 'alarm' + a);
          }
        }
      }
    }
  }

  function tickPhysics() {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed) continue;
      if (inst.gravity) {
        var rad = inst.gravity_direction * Math.PI / 180;
        inst.hspeed += inst.gravity * Math.cos(rad);
        inst.vspeed -= inst.gravity * Math.sin(rad);
      }
      if (inst.friction) {
        // GM friction reduces speed along the current direction and rewrites
        // both components (the old code wrote a dead `speed` property).
        var sp = MM.motionSpeed(inst);
        if (sp > 0) {
          var ns = Math.max(0, sp - inst.friction);
          if (ns <= 0) { inst.hspeed = 0; inst.vspeed = 0; }
          else { inst.hspeed *= ns / sp; inst.vspeed *= ns / sp; }
        }
      }
      inst.x += inst.hspeed;
      inst.y += inst.vspeed;
    }
  }

  // -------------------------------------------------------------------
  // Players must never stay wedged inside level geometry.  The decompiled
  // game blocks horizontal movement with a one-pixel look-ahead, but vertical
  // motion (flying, springs) can push the mask into a wall sideways; the
  // "ground" probe then sees that wall and disables gravity, leaving the hero
  // hanging in mid-air forever.  Revert the offending axis instead.
  // -------------------------------------------------------------------
  function isPlayerInst(inst) {
    var def = inst.object_index;
    if (!def) return false;
    if (def._isPlayer === undefined) def._isPlayer = MM.objectChainHas(def, MM.objects['Pers_Obj']);
    return def._isPlayer;
  }

  function isLevelSolid(def) {
    if (!def) return false;
    return MM.objectChainHas(def, MM.objects['Solid_Mask']) ||
           MM.objectChainHas(def, MM.objects['Break_Mask']);
  }

  function overlapsLevelSolid(inst, x, y) {
    var box = MM.bbox(inst, x, y);
    if (!box) return false;
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === inst || o._destroyed || o._deactivated) continue;
      if (!isLevelSolid(o.object_index)) continue;
      var ob = MM.bbox(o);
      if (ob && box.l < ob.r && box.r > ob.l && box.t < ob.b && box.b > ob.t) return true;
    }
    return false;
  }

  function resolvePlayerOverlap() {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed || inst._deactivated || !isPlayerInst(inst)) continue;
      if (inst.y < 0) {
        inst.y = 0;
        if (inst.vspeed < 0.2) inst.vspeed = 0.2;
      }
      if (!overlapsLevelSolid(inst, inst.x, inst.y)) continue;
      if (inst._px !== undefined && !overlapsLevelSolid(inst, inst._px, inst.y)) {
        inst.x = inst._px;
        MM.globals.vel = 0;
        continue;
      }
      if (inst._py !== undefined && !overlapsLevelSolid(inst, inst.x, inst._py)) {
        inst.y = inst._py;
        inst.vspeed = 0;
      }
    }
  }

  function tickCollisions() {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed || inst._deactivated) continue;
      var evs = MM.defCollisionEvents(inst.object_index);
      if (!evs) continue;
      for (var e = 0; e < evs.length; e++) {
        if (inst._destroyed) break;
        var ev = evs[e];
        var box = MM.bbox(inst);
        if (!box) break;
        var targets = MM.query(ev.target);
        var tdef = typeof ev.target === 'string' ? MM.objects[ev.target] : ev.target;
        eachOverlapping(tdef, targets, box, function (o, ob) {
          if (o === inst || o._destroyed) return false;
          if (MM.collides ? MM.collides(inst, o, box, ob) : boxesOverlap(box, ob)) {
            MM.interp && MM.interp.run(ev.code, {
              self: inst, other: o, name: inst.object_name + ':' + ev.evName
            });
          }
          return inst._destroyed;
        });
      }
    }
  }

  // An object inherits its parent's collision events: Knuckles has no
  // collision with Spring_Mask of its own, the one declared on Pers_Obj is
  // what stops him from walking through springs.  Walk the chain, nearest
  // definition wins for a given target object.
  MM.defCollisionEvents = function (def) {
    if (def._collisionEvents) return def._collisionEvents;
    var out = [];
    var seen = Object.create(null);
    var d = def;
    while (d) {
      for (var k in d.events) {
        if (k.indexOf('collision_') === 0 && typeof d.events[k] === 'string' && d.events[k].length) {
          var target = k.slice(10);
          if (seen[target]) continue;
          seen[target] = true;
          out.push({ target: target, evName: k, code: MM.resolveCode(d.events[k]) });
        }
      }
      d = d.parent ? MM.resolveObject(d.parent) : null;
    }
    def._collisionEvents = out;
    return out;
  };

  function tickOutsideRoom() {
    var room = MM.state.room;
    if (!room) return;
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed || inst._deactivated) continue;
      var b = MM.bbox(inst);
      if (!b) continue;
      if (b.r < 0 || b.b < 0 || b.l > room.w || b.t > room.h) {
        if (MM.eventCode(inst.object_index, 'other_outside_room')) MM.runEvent(inst, 'other_outside_room');
      }
    }
  }

  function tickAnimation() {
    var list = MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed) continue;
      var spr = inst.sprite_index;
      if (!spr || !spr.frames) continue;
      var n = spr.frames.length;
      if (n <= 1 || !inst.image_speed) continue;
      var v = inst.image_index + inst.image_speed;
      if (!isFinite(v)) { inst.image_index = 0; continue; }
      var wrapped = false;
      if (v >= n || v < 0) {
        v %= n;
        if (v < 0) v += n;
        wrapped = true;
      }
      inst.image_index = v;
      if (wrapped && MM.eventCode(inst.object_index, 'other_animation_end')) {
        MM.runEvent(inst, 'other_animation_end');
      }
    }
  }

  function flushDestroyed() {
    var list = MM.state.instances;
    var any = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i]._destroyed && !list[i]._removed) { any = true; break; }
    }
    if (!any) return;
    for (var j = 0; j < list.length; j++) {
      var inst = list[j];
      if (inst._destroyed && !inst._removed) {
        inst._removed = true;
        MM.runEvent(inst, 'destroy');
      }
    }
    MM.state.instances = list.filter(function (i) { return !i._removed; });
    MM.state.version++;
  }

  function tickFx() {
    var fx = MM.fx;
    if (fx.shakeFrames > 0) {
      fx.shakeFrames--;
      if (fx.shakeFrames <= 0) {
        fx.shakePower = 0; fx.shakeX = 0; fx.shakeY = 0;
      } else {
        fx.shakeX = (Math.random() * 2 - 1) * fx.shakePower;
        fx.shakeY = (Math.random() * 2 - 1) * fx.shakePower;
      }
    }
    if (fx.flashAlpha > 0) {
      fx.flashAlpha = Math.max(0, fx.flashAlpha - fx.flashDecay);
    }
  }

  // GameMaker view following: the view is centred on the instance's x/y (its
  // origin -- NOT the bbox centre, which changes with every animation frame
  // and made the camera twitch), and view_hspeed/vspeed are a maximum number
  // of pixels per step, not a percentage of the remaining distance.
  function updateCamera() {
    var room = MM.state.room;
    if (!room) return;
    for (var i = 0; i < 8; i++) {
      if (!MM.view.visible[i]) continue;
      var w = MM.view.wview[i], h = MM.view.hview[i];
      var targetObj = MM.view.object[i];
      var vx = MM.view.xview[i], vy = MM.view.yview[i];
      if (targetObj) {
        var list = MM.query(targetObj);
        if (list.length) {
          var inst = list[0];
          var tx = inst.x - w / 2, ty = inst.y - h / 2;
          var hs = MM.view.hspeed[i], vs = MM.view.vspeed[i];
          if (hs === undefined || hs < 0) vx = tx;
          else {
            var dx2 = tx - vx;
            if (dx2 > hs) dx2 = hs; else if (dx2 < -hs) dx2 = -hs;
            vx += dx2;
          }
          if (vs === undefined || vs < 0) vy = ty;
          else {
            var dy2 = ty - vy;
            if (dy2 > vs) dy2 = vs; else if (dy2 < -vs) dy2 = -vs;
            vy += dy2;
          }
        }
      }
      MM.view.xview[i] = Math.max(0, Math.min(vx, Math.max(0, room.w - w)));
      MM.view.yview[i] = Math.max(0, Math.min(vy, Math.max(0, room.h - h)));
    }
  }

  // -------------------------------------------------------------------
  // Paths (GM semantics: path_start(path, speed, endaction, absolute))
  // -------------------------------------------------------------------
  function pathMetrics(def) {
    if (def._metrics) return def._metrics;
    var pts = def.points || [];
    var segs = [], total = 0;
    for (var i = 0; i + 1 < pts.length; i++) {
      var dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
      var len = Math.sqrt(dx * dx + dy * dy);
      segs.push(len); total += len;
    }
    if (def.closed && pts.length > 1) {
      var dx2 = pts[0].x - pts[pts.length - 1].x;
      var dy2 = pts[0].y - pts[pts.length - 1].y;
      var l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      segs.push(l2); total += l2;
    }
    def._metrics = { segs: segs, total: total, closed: !!def.closed };
    return def._metrics;
  }

  function pathPoint(def, info, pos) {
    var pts = def.points || [];
    if (!pts.length) return null;
    if (pos <= 0) return { x: pts[0].x, y: pts[0].y };
    var count = info.closed ? pts.length : pts.length - 1;
    for (var i = 0; i < count; i++) {
      var len = info.segs[i] || 0;
      if (pos <= len || i === count - 1) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var t = len > 0 ? Math.max(0, Math.min(1, pos / len)) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      pos -= len;
    }
    var last = pts[pts.length - 1];
    return { x: last.x, y: last.y };
  }

  function tickPaths() {
    var list = MM.state.instances;
    var fps = MM.FPS || 60;
    for (var i = 0; i < list.length; i++) {
      var inst = list[i];
      if (inst._destroyed || !inst._path) continue;
      var p = inst._path, def = p.def;
      var info = pathMetrics(def);
      if (!info.total) { inst._path = null; continue; }
      // absolute = pixels/step, relative = percent of the path per second.
      var stepDist = p.absolute
        ? p.speed
        : (p.speed / 100) * info.total / fps;
      if (!isFinite(stepDist)) stepDist = 0;
      p.pos = (p.pos || 0) + stepDist * (p.dir || 1);
      var finished = false;
      if (p.pos >= info.total) {
        if (p.action === 1 || p.action === 2) p.pos -= info.total;
        else if (p.action === 3) { p.pos = info.total - (p.pos - info.total); p.dir = -1; }
        else { p.pos = info.total; finished = true; }
      } else if (p.pos < 0) {
        if (p.action === 1 || p.action === 2) p.pos += info.total;
        else if (p.action === 3) { p.pos = -p.pos; p.dir = 1; }
        else { p.pos = 0; finished = true; }
      }
      var pt = pathPoint(def, info, p.pos);
      if (pt) { inst.x = pt.x; inst.y = pt.y; }
      if (finished) {
        inst._path = null;
        if (MM.eventCode(inst.object_index, 'other_end_of_path')) MM.runEvent(inst, 'other_end_of_path');
      }
    }
  }

  MM.step = function () {
    if (MM.loading && MM.loading.total) return;
    if (MM.state.paused) { MM.clearInputFrame(); return; }
    MM.state.frame++;
    MM.state.frameInRoom++;
    var list;
    var i;

    list = MM.state.instances;
    for (i = 0; i < list.length; i++) {
      if (!list[i]._destroyed && isPlayerInst(list[i])) { list[i]._px = list[i].x; list[i]._py = list[i].y; }
    }
    list = MM.state.instances.slice();
    for (i = 0; i < list.length; i++) if (!list[i]._destroyed) MM.runEvent(list[i], 'begin_step');
    tickAlarms();
    list = MM.state.instances.slice();
    for (i = 0; i < list.length; i++) if (!list[i]._destroyed) MM.runEvent(list[i], 'step');
    tickPhysics();
    tickPaths();
    tickOutsideRoom();
    tickCollisions();
    resolvePlayerOverlap();
    list = MM.state.instances.slice();
    for (i = 0; i < list.length; i++) if (!list[i]._destroyed) MM.runEvent(list[i], 'end_step');
    tickAnimation();
    flushDestroyed();
    tickFx();
    updateCamera();
    if (MM.dispatchKeyEvents) MM.dispatchKeyEvents();
    if (MM.onStep) MM.onStep();
    MM.clearInputFrame();

    if (MM.state.pendingRoom != null) MM._loadRoom(MM.state.pendingRoom);
  };

  // -------------------------------------------------------------------
  // Комнаты
  // -------------------------------------------------------------------
  MM.roomGoto = function (name, immediate) {
    var room = typeof name === 'string' ? MM.rooms[name] : name;
    if (!room) { MM.warn('roomGoto: нет комнаты "' + name + '"'); return; }
    MM.state.pendingRoom = room.name;
    if (immediate) MM._loadRoom(room.name);
  };

  MM.roomRestart = function () {
    if (MM.state.room) MM.state.pendingRoom = MM.state.room.name;
  };

  MM.gameRestart = function () {
    MM.state.globals = {};
    MM.globals = MM.state.globals;
    MM.state.instances = [];
    MM.state.version++;
    MM.state.frame = 0;
    MM.fx.shakePower = 0; MM.fx.shakeFrames = 0;
    MM.fx.flashAlpha = 0; MM.fx.overlayAlpha = 0; MM.fx.scanlines = 0;
    MM.roomGoto(MM.state.bootRoom, true);
  };

  MM.applyRoomView = function (room) {
    var i;
    for (i = 0; i < 8; i++) {
      MM.view.visible[i] = false;
      MM.view.object[i] = null;
      MM.view.xview[i] = 0; MM.view.yview[i] = 0;
      MM.view.wview[i] = MM.VIEW_W; MM.view.hview[i] = MM.VIEW_H;
      MM.view.portX[i] = 0; MM.view.portY[i] = 0;
      MM.view.portW[i] = MM.VIEW_W; MM.view.portH[i] = MM.VIEW_H;
      MM.view.hborder[i] = 64; MM.view.vborder[i] = 48;
      MM.view.hspeed[i] = -1; MM.view.vspeed[i] = -1;
    }
    var views = room.views;
    if ((!views || !views.length) && room.view) views = [room.view];
    if (!views || !views.length) {
      MM.view.visible[0] = true;
      return;
    }
    for (i = 0; i < views.length && i < 8; i++) {
      var v = views[i];
      if (!v) continue;
      MM.view.visible[i] = !!(v.enabled === undefined ? true : v.enabled);
      MM.view.wview[i] = v.w || MM.VIEW_W;
      MM.view.hview[i] = v.h || MM.VIEW_H;
      MM.view.portX[i] = v.portX || 0;
      MM.view.portY[i] = v.portY || 0;
      MM.view.portW[i] = v.portW || MM.VIEW_W;
      MM.view.portH[i] = v.portH || MM.VIEW_H;
      MM.view.object[i] = v.object || null;
      MM.view.hborder[i] = v.borderX != null ? v.borderX : 64;
      MM.view.vborder[i] = v.borderY != null ? v.borderY : 48;
      MM.view.hspeed[i] = v.speedX != null ? v.speedX : -1;
      MM.view.vspeed[i] = v.speedY != null ? v.speedY : -1;
      MM.view.xview[i] = v.x == null ? 0 : v.x;
      MM.view.yview[i] = v.y == null ? 0 : v.y;
    }
    var any = false;
    for (i = 0; i < 8; i++) if (MM.view.visible[i]) any = true;
    if (!any) MM.view.visible[0] = true;
  };

  function tileBase(tl, room) {
    var ts = tl.size || 16;
    var rows = tl.rows;
    return {
      ts: ts,
      rows: rows,
      x0: tl.xOffset || 0,
      y0: room.h - rows.length * ts + (tl.yOffset || 0)
    };
  }

  function tileCharSolid(tl, ch) {
    if (!ch || ch === ' ' || ch === '.') return false;
    var ent = tl.legend[ch];
    if (!ent) return false;
    if (typeof ent === 'string') return true;
    return ent.solid !== false;
  }

  // Генерация коллизий из тайлового слоя: горизонтальные "полосы" вместо тайлов
  function generateTileCollisions(room) {
    var tl = room.tileLayer;
    if (!tl || !tl.solid) return [];
    var objName = tl.solidObject || 'oBlockMask';
    if (!MM.objects[objName]) {
      MM.warn('комната ' + room.name + ': нет объекта коллизий "' + objName + '"');
      return [];
    }
    var b = tileBase(tl, room);
    var out = [];
    for (var r = 0; r < b.rows.length; r++) {
      var row = b.rows[r];
      var c = 0;
      while (c < row.length) {
        if (!tileCharSolid(tl, row[c])) { c++; continue; }
        var start = c;
        while (c < row.length && tileCharSolid(tl, row[c])) c++;
        var len = c - start;
        out.push({
          obj: objName,
          x: b.x0 + start * b.ts,
          y: b.y0 + r * b.ts,
          vars: { mask: { w: len * b.ts, h: b.ts, ox: 0, oy: 0 } }
        });
      }
    }
    return out;
  }

  function drawTileLayers(ctx, room, vx, vy) {
    var tl = room.tileLayer;
    if (!tl) return;
    var b = tileBase(tl, room);
    if (!b.rows.length) return;
    var maxCols = 0;
    for (var q = 0; q < b.rows.length; q++) maxCols = Math.max(maxCols, b.rows[q].length);
    var c0 = Math.max(0, Math.floor(vx / b.ts));
    var c1 = Math.min(maxCols - 1, Math.floor((vx + MM.VIEW_W) / b.ts) + 1);
    var r0 = Math.max(0, Math.floor(vy / b.ts));
    var r1 = Math.min(b.rows.length - 1, Math.floor((vy + MM.VIEW_H) / b.ts) + 1);
    for (var r = r0; r <= r1; r++) {
      var row = b.rows[r];
      for (var c = c0; c <= c1 && c < row.length; c++) {
        var ch = row[c];
        if (!ch || ch === ' ' || ch === '.') continue;
        var ent = tl.legend[ch];
        if (!ent) continue;
        var sprName;
        if (typeof ent === 'string') sprName = ent;
        else sprName = (r > 0 && c < b.rows[r - 1].length && b.rows[r - 1][c] === ch) ? ent.fill : ent.top;
        var spr = MM.sprites[sprName];
        if (!spr) continue;
        MM.gfx.drawSprite(ctx, spr, 0, b.x0 + c * b.ts + spr.origin[0] * spr.w, b.y0 + r * b.ts + spr.origin[1] * spr.h, {});
      }
    }
  }

  MM._loadRoom = function (name) {
    var room = MM.rooms[name];
    if (!room) { MM.warn('_loadRoom: нет комнаты "' + name + '"'); return; }
    // room_end у старых
    var old = MM.state.instances.slice();
    for (var i = 0; i < old.length; i++) {
      if (!old[i]._destroyed) MM.runEvent(old[i], 'room_end');
    }
    MM.state.instances = old.filter(function (x) { return x.persistent && !x._removed && !x._destroyed; });
    MM.state.room = room;
    MM.state.pendingRoom = null;
    MM.state.frameInRoom = 0;
    MM.state.loadingRoom = true;
    MM.applyRoomView(room);
    MM.view.xview[0] = MM.view.xview[0] || 0;
    MM.view.yview[0] = MM.view.yview[0] || 0;

    var specs = generateTileCollisions(room).concat(room.instances || []);
    for (var s = 0; s < specs.length; s++) {
      var sp = specs[s];
      var vars = sp.vars;
      if (sp.sx != null || sp.sy != null || sp.rot || sp.imgIdx) {
        vars = {};
        if (sp.vars) for (var vk in sp.vars) vars[vk] = sp.vars[vk];
        if (sp.sx != null) vars.image_xscale = sp.sx;
        if (sp.sy != null) vars.image_yscale = sp.sy;
        if (sp.rot) vars.image_angle = sp.rot;
        if (sp.imgIdx) vars.image_index = sp.imgIdx;
      }
      var newInst = MM.instanceCreate(sp.x, sp.y, sp.obj, vars, true);
      if (newInst && MM.runInstanceCode) MM.runInstanceCode(sp, newInst);
      else if (newInst) MM.runEvent(newInst, 'create');
    }
    MM.state.loadingRoom = false;

    // PAUSER is persistent AND placed in most rooms.  GameMaker would stack a
    // new pause handler on every room transition (three pause screens, three
    // audio pauses, three "resume" waves) -- keep exactly one.
    (function dedupePauser() {
      var found = [];
      for (var i2 = 0; i2 < MM.state.instances.length; i2++) {
        var it = MM.state.instances[i2];
        if (!it._destroyed && it.object_name === 'PAUSER') found.push(it);
      }
      for (var j2 = 1; j2 < found.length; j2++) found[j2]._destroyed = true;
    })();

    if (room.creation) {
      MM.interp && MM.interp.run(MM.resolveCode(room.creation), {
        self: { x: 0, y: 0, _roomCreation: true },
        other: MM.NOONE,
        name: room.name + ':creation'
      });
    }
    var live = MM.state.instances.slice();
    for (var k = 0; k < live.length; k++) {
      if (!live[k]._destroyed) MM.runEvent(live[k], 'room_start');
    }
    MM.state.version++;
    if (MM.startRoomPreload) MM.startRoomPreload(room);
    if (MM.onRoomLoaded) MM.onRoomLoaded(room);
  };

  // -------------------------------------------------------------------
  // Отрисовка
  // -------------------------------------------------------------------
  MM.gfx = {
    color: '#ffffff',
    alpha: 1,
    halign: 0,
    valign: 0,
    font: 1,
    blend: 'normal'
  };

  function applyDrawState(ctx) {
    ctx.globalAlpha = Math.max(0, Math.min(1, MM.gfx.alpha));
    ctx.globalCompositeOperation = MM.gfx.blend === 'add' ? 'lighter' : 'source-over';
  }

  MM.gfx.drawSprite = function (ctx, spr, frameIdx, x, y, opts) {
    if (!spr) return;
    var n = spr.frames.length;
    var fi = Math.floor(frameIdx || 0);
    fi = ((fi % n) + n) % n;
    var cv = buildSpriteCanvas(spr, fi);
    if (!cv) return;
    opts = opts || {};
    var ox = spr.originPx ? spr.originPx[0] : spr.origin[0] * spr.w;
    var oy = spr.originPx ? spr.originPx[1] : spr.origin[1] * spr.h;
    var sx = opts.xscale == null ? 1 : opts.xscale;
    var sy = opts.yscale == null ? 1 : opts.yscale;
    var ang = (opts.angle || 0) * Math.PI / 180;
    var alpha = opts.alpha == null ? 1 : opts.alpha;
    var useTint = opts.blend && /^#/.test(opts.blend) && opts.blend.toLowerCase() !== '#ffffff';
    var img = useTint ? MM.spriteTinted(spr, fi, opts.blend) : cv;
    if (!img) return;
    var prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * prevAlpha));
    if (ang || sx !== 1 || sy !== 1) {
      ctx.save();
      ctx.translate(x, y);
      if (ang) ctx.rotate(ang);
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      ctx.drawImage(img, -ox, -oy);
      ctx.restore();
    } else {
      ctx.drawImage(img, Math.round(x - ox), Math.round(y - oy));
    }
    ctx.globalAlpha = prevAlpha;
  };

  MM.gfx.drawSelf = function (ctx, inst) {
    MM.gfx.drawSprite(ctx, inst.sprite_index, inst.image_index, inst.x, inst.y, {
      xscale: inst.image_xscale, yscale: inst.image_yscale, angle: inst.image_angle,
      alpha: inst.image_alpha, blend: inst.image_blend
    });
  };

  MM.renderFrame = function () {
    var ctx = MM.ctx;
    if (!ctx) return;
    var room = MM.state.room;
    if (!room) return;
    var W = MM.VIEW_W, H = MM.VIEW_H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = room.bgColor || '#000000';
    ctx.fillRect(0, 0, W, H);
    if (MM.loading && MM.loading.total) {
      var L = MM.loading;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#c8c8c8';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Loading  ' + L.done + ' / ' + L.total, W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }

    var view = MM.activeView();
    var vx = view.x, vy = view.y, vw = view.w, vh = view.h;
    var sx = Math.round(MM.fx.shakeX), sy = Math.round(MM.fx.shakeY);
    var drawables = MM.state.instances
      .filter(function (i) { return !i._destroyed && !i._deactivated && i.visible; })
      .slice()
      .sort(function (a, b) { return b.depth - a.depth; });

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(view.sx, 0, 0, view.sy,
      Math.round(view.px - vx * view.sx) + sx,
      Math.round(view.py - vy * view.sy) + sy);
    MM.gfxCtx = ctx;
    if (MM.gfx.drawBackgrounds) MM.gfx.drawBackgrounds(ctx, room, vx, vy, false);
    drawTileLayers(ctx, room, vx, vy);
    for (var i = 0; i < drawables.length; i++) {
      var inst = drawables[i];
      if (MM.eventCode(inst.object_index, 'draw')) {
        MM.runEvent(inst, 'draw');
      } else if (inst.sprite_index) {
        // отсечение за экраном для обычных спрайтовых объектов
        var spr = inst.sprite_index;
        var sw = spr.w * Math.abs(inst.image_xscale), shh = spr.h * Math.abs(inst.image_yscale);
        if (inst.x + sw < vx - 64 || inst.x - sw > vx + vw + 64 ||
            inst.y + shh < vy - 64 || inst.y - shh > vy + vh + 64) continue;
        MM.gfx.drawSelf(ctx, inst);
      }
    }
    if (MM.gfx.drawBackgrounds) MM.gfx.drawBackgrounds(ctx, room, vx, vy, true);
    ctx.restore();

    // GUI-слой
    ctx.save();
    ctx.translate(sx, sy);
    MM.gfxCtx = ctx;
    for (var j = 0; j < drawables.length; j++) {
      var g = drawables[j];
      if (g._destroyed) continue;
      if (MM.eventCode(g.object_index, 'draw_gui')) MM.runEvent(g, 'draw_gui');
    }
    ctx.restore();
    MM.gfxCtx = null;

    // Эффекты поверх
    var fx = MM.fx;
    if (fx.flashAlpha > 0) {
      ctx.globalAlpha = Math.min(1, fx.flashAlpha);
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (fx.overlayAlpha > 0) {
      ctx.globalAlpha = Math.min(1, fx.overlayAlpha);
      ctx.fillStyle = fx.overlayColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (fx.scanlines > 0) {
      ctx.globalAlpha = Math.min(1, fx.scanlines);
      ctx.fillStyle = '#000000';
      for (var y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.globalAlpha = 1;
    }
    if (MM.onDraw) MM.onDraw(ctx, W, H);
  };

  // -------------------------------------------------------------------
  // Ввод
  // -------------------------------------------------------------------
  MM.input = {
    keys: {}, pressed: {}, released: {},
    anyKeyPressed: false, lastKey: 0,
    mouseX: 0, mouseY: 0,
    buttons: {}, btnPressed: {}, btnReleased: {},
    _clear: function () {
      this.pressed = {};
      this.released = {};
      this.btnPressed = {};
      this.btnReleased = {};
      this.anyKeyPressed = false;
    }
  };
  MM.clearInputFrame = function () { MM.input._clear(); };

  MM.attachInput = function (canvas) {
    if (typeof window === 'undefined' || !canvas) return;
    window.addEventListener('keydown', function (e) {
      if (!MM.input.keys[e.keyCode]) MM.input.pressed[e.keyCode] = true;
      MM.input.keys[e.keyCode] = true;
      MM.input.anyKeyPressed = true;
      MM.input.lastKey = e.keyCode;
      if ([32, 37, 38, 39, 40, 112, 113].indexOf(e.keyCode) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) {
      MM.input.keys[e.keyCode] = false;
      MM.input.released[e.keyCode] = true;
    });
    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      MM.input.mouseX = (e.clientX - r.left) / r.width * MM.VIEW_W;
      MM.input.mouseY = (e.clientY - r.top) / r.height * MM.VIEW_H;
    });
    canvas.addEventListener('mousedown', function (e) {
      if (!MM.input.buttons[e.button]) MM.input.btnPressed[e.button] = true;
      MM.input.buttons[e.button] = true;
    });
    window.addEventListener('mouseup', function (e) {
      MM.input.buttons[e.button] = false;
      MM.input.btnReleased[e.button] = true;
    });
    window.addEventListener('blur', function () {
      MM.input.keys = {};
      MM.input.buttons = {};
    });
  };

  // -------------------------------------------------------------------
  // Переопределения из редактора (localStorage)
  // -------------------------------------------------------------------
  MM.overrides = {
    KEY: 'minimaker.edits.v1',
    enabled: true,
    data: null,
    load: function () {
      try {
        if (typeof localStorage === 'undefined') { this.data = null; return null; }
        var s = localStorage.getItem(this.KEY);
        this.data = s ? JSON.parse(s) : null;
      } catch (e) { this.data = null; }
      return this.data;
    },
    save: function (d) {
      this.data = d;
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {}
    },
    clear: function () {
      this.data = null;
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(this.KEY); } catch (e) {}
    },
    apply: function () {
      if (!this.enabled || !this.data) return false;
      var d = this.data;
      if (d.objects) {
        for (var on in d.objects) {
          var def = MM.objects[on];
          if (!def) continue;
          var oe = d.objects[on].events || {};
          for (var ev in oe) if (typeof oe[ev] === 'string') def.events[ev] = oe[ev];
          def._collisionEvents = null;
        }
      }
      if (d.rooms) {
        for (var rn in d.rooms) {
          var room = MM.rooms[rn];
          if (!room) continue;
          var ro = d.rooms[rn];
          if (ro.instances) room.instances = ro.instances;
          if (typeof ro.creation === 'string') room.creation = ro.creation;
        }
      }
      if (MM.interp && MM.interp.clearCache) MM.interp.clearCache();
      return true;
    }
  };

  // -------------------------------------------------------------------
  // Запуск
  // -------------------------------------------------------------------
  MM.boot = function (opts) {
    opts = opts || {};
    MM.VIEW_W = opts.width || MM.VIEW_W;
    MM.VIEW_H = opts.height || MM.VIEW_H;
    MM.canvas = opts.canvas || MM.canvas || null;
    if (MM.canvas && MM.canvas.getContext) {
      MM.ctx = MM.canvas.getContext('2d');
      if (MM.ctx) MM.ctx.imageSmoothingEnabled = false;
    }
    MM.attachInput(MM.canvas);
    MM.state.bootRoom = opts.room || MM.state.bootRoom;
    if (opts.loadOverrides !== false) {
      MM.overrides.load();
      MM.overrides.apply();
    }
    MM.state.running = true;
    MM._loadRoom(MM.state.bootRoom);
    if (opts.autostart !== false && typeof requestAnimationFrame !== 'undefined') {
      var acc = 0, last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var stepMs = 1000 / MM.FPS;
      var loop = function (t) {
        if (!MM.state.running) return;
        var dt = t - last; last = t;
        if (dt > 250) dt = 250;
        acc += dt;
        var guard = 0;
        while (acc >= stepMs && guard++ < 5) {
          MM.step();
          acc -= stepMs;
        }
        MM.renderFrame();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    return MM;
  };

  MM.stop = function () { MM.state.running = false; };

  // -------------------------------------------------------------------
  // Диагностика
  // -------------------------------------------------------------------
  MM.debug = {
    validateProject: function () {
      var res = { objects: 0, events: 0, rooms: 0, scripts: 0, errors: [], warnings: [] };
      if (!MM.interp || !MM.interp.check) return res;
      for (var on in MM.objects) {
        var def = MM.objects[on];
        res.objects++;
        for (var ev in def.events) {
          if (typeof def.events[ev] !== 'string' || !def.events[ev].length) continue;
          res.events++;
          var err = MM.interp.check(MM.resolveCode(def.events[ev]), on + ':' + ev);
          if (err) res.errors.push(err);
        }
      }
      for (var rn in MM.rooms) {
        var room = MM.rooms[rn];
        res.rooms++;
        if (room.creation) {
          var err2 = MM.interp.check(MM.resolveCode(room.creation), rn + ':creation');
          if (err2) res.errors.push(err2);
        }
        for (var i = 0; i < (room.instances || []).length; i++) {
          var sp = room.instances[i];
          if (!MM.objects[sp.obj] && typeof sp.obj === 'string') {
            res.errors.push(rn + ': отсутствует объект "' + sp.obj + '"');
          }
        }
      }
      for (var sn in MM.scripts) {
        res.scripts++;
        var err3 = MM.interp.check(MM.resolveCode(MM.scripts[sn]), 'script:' + sn);
        if (err3) res.errors.push(err3);
      }
      res.warnings = MM.warnings.slice();
      return res;
    },
    summary: function () {
      return {
        version: MM.VERSION,
        sprites: Object.keys(MM.sprites).length,
        objects: Object.keys(MM.objects).length,
        rooms: Object.keys(MM.rooms).length,
        scripts: Object.keys(MM.scripts).length,
        sounds: Object.keys(MM.sounds).length,
        musics: Object.keys(MM.musics).length,
        warnings: MM.warnings.length
      };
    }
  };

})();
