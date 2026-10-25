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

  // Fixed-composition screens (title, language, data select, logos).  These are
  // drawn for a 320-wide view and are not built for a wider camera, so the 16:9
  // path keeps their original port scale and only extends the backdrop.
  MM.STATIC_ART_ROOMS = {
    LanguageSelect_19: 1,
    TitleScreen_3: 1,
    DataSelect_5: 1,
    JKN_0: 1,
    SEGA_2: 1
  };
  MM.isStaticArtRoom = function () {
    var room = MM.state && MM.state.room;
    return !!(room && MM.STATIC_ART_ROOMS[room.name]);
  };

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
    // A few rooms (JKN_0) declare a 1024x768 port: scale the whole port down
    // proportionally, never wider than the surface.
    if (pw > MM.VIEW_W || ph > MM.VIEW_H) {
      var fit = Math.min(MM.VIEW_W / pw, MM.VIEW_H / ph);
      pw *= fit;
      ph *= fit;
    }
    var sx = pw / vw, sy = ph / vh;
    // Camera rooms get a wider logical view (fills 16:9 with real level/art
    // instead of bars).  Static art screens keep their authored 320-wide
    // composition and only extend the backdrop.
    if (MM.aspect !== '4:3' && MM.isStaticArtRoom && MM.isStaticArtRoom()) {
      var artW = MM.VIEW_W / sx;
      var artEx = Math.max(0, (artW - vw) / 2);
      return {
        index: idx,
        x: MM.view.xview[idx] || 0,
        y: MM.view.yview[idx] || 0,
        w: artW, h: vh,
        px: 0, py: 0,
        pw: MM.VIEW_W, ph: MM.VIEW_H,
        sx: sx, sy: sy,
        extra: artEx
      };
    }
    if (MM.aspect !== '4:3') {
      var wideW = Math.max(vw, Math.round(vh * MM.VIEW_W / MM.VIEW_H));
      var wex = Math.max(0, (wideW - vw) / 2);
      return {
        index: idx,
        x: MM.view.xview[idx] || 0,
        y: MM.view.yview[idx] || 0,
        w: wideW, h: vh,
        px: 0, py: 0,
        pw: MM.VIEW_W, ph: MM.VIEW_H,
        sx: MM.VIEW_W / wideW,
        sy: MM.VIEW_H / vh,
        extra: wex
      };
    }
    // 4:3: the authored view (320x260) is shown with ONE uniform scale.  The
    // old code used the port aspect (640x480) independently on both axes,
    // which stretched every sprite ~8% wider and made logos/portraits look
    // squashed.  Letterbox the scaled view inside the port instead.
    var fitS = Math.min(sx, sy);
    var fitW = vw * fitS, fitH = vh * fitS;
    return {
      index: idx,
      x: MM.view.xview[idx] || 0,
      y: MM.view.yview[idx] || 0,
      w: vw, h: vh,
      px: Math.max(0, Math.round((MM.VIEW_W - fitW) / 2)),
      py: Math.max(0, Math.round((MM.VIEW_H - fitH) / 2)),
      pw: fitW, ph: fitH,
      sx: fitS,
      sy: fitS,
      extra: 0
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
    if (!spr._tints) spr._tints = {};
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

  // Every instance asks for its events every frame; walking the parent chain
  // and resolving aliases each time dominated the profile.  The answer only
  // depends on (object def, event name), so cache it on the def.
  MM.eventCode = function (def, evName) {
    if (!def) return null;
    var cache = def._eventCode;
    if (!cache) cache = def._eventCode = Object.create(null);
    var hit = cache[evName];
    if (hit !== undefined) return hit;
    var code = null;
    var alias = EV_ALIAS[evName];
    var d = def;
    while (d) {
      if (d.events && typeof d.events[evName] === 'string' && d.events[evName].length) { code = MM.resolveCode(d.events[evName]); break; }
      if (alias && d.events && typeof d.events[alias] === 'string' && d.events[alias].length) { code = MM.resolveCode(d.events[alias]); break; }
      d = d.parent ? MM.resolveObject(d.parent) : null;
    }
    cache[evName] = code;
    return code;
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

  // GML bounding boxes are inclusive pixel ranges: two masks that share an
  // edge row DO collide.  The resting position is therefore one pixel above
  // the floor (see move_contact_solid), which keeps horizontal probes and the
  // spindash rectangle clear of the ground.
  function boxesOverlap(a, b) {
    return a.l <= b.r && a.r >= b.l && a.t <= b.b && a.b >= b.t;
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
        if (!ob || ob.l > r || ob.r < l || ob.t > b || ob.b < t) continue;
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
      if (e.l > r) break;
      if (e.r < l || e.t > b || e.b < t) continue;
      if (e.o._destroyed) continue;
      if (cb(e.o, e)) return true;
    }
    for (var k = 0; k < rec.dyn.length; k++) {
      var d = rec.dyn[k];
      if (d._destroyed) continue;
      var db = MM.bbox(d);
      if (!db || db.l > r || db.r < l || db.t > b || db.b < t) continue;
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
    return eachOverlapping(def, list, selfBox, function (o, ob) {
      if (notme !== false && o === who) return false;
      return MM.collides ? MM.collides(who, o, selfBox, ob, x, y) : boxesOverlap(selfBox, ob);
    });
  };

  MM.instancePlace = function (inst, x, y, objValue) {
    var who = inst instanceof Instance ? inst : MM.state.currentSelf;
    var selfBox = MM.bbox(who, x, y);
    if (!selfBox) return MM.NOONE;
    var list = MM.query(objValue);
    var def = typeof objValue === 'string' ? MM.objects[objValue] : objValue;
    var found = MM.NOONE;
    eachOverlapping(def, list, selfBox, function (o, ob) {
      if (o === who) return false;
      if (MM.collides ? MM.collides(who, o, selfBox, ob, x, y) : boxesOverlap(selfBox, ob)) {
        found = o;
        return true;
      }
      return false;
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

  MM.collisionRectangle = function (x1, y1, x2, y2, objValue, notme, prec) {
    var l = Math.min(x1, x2), r = Math.max(x1, x2);
    var t = Math.min(y1, y2), b = Math.max(y1, y2);
    var rect = { l: l, r: r, t: t, b: b };
    var def = typeof objValue === 'string' ? MM.objects[objValue] : objValue;
    var list = MM.query(def || objValue);
    var self = MM.state.currentSelf;
    if (!def || !def.name || list.length < 48) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (notme && o === self) continue;
        var ob = MM.bbox(o);
        if (ob && ob.l <= r && ob.r >= l && ob.t <= b && ob.b >= t) {
          if (!prec || !MM.maskOverlapsBox || MM.maskOverlapsBox(o, rect)) return o;
        }
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
      if (!prec || !MM.maskOverlapsBox || MM.maskOverlapsBox(io, rect)) return io;
    }
    for (var k = 0; k < rec.dyn.length; k++) {
      var d = rec.dyn[k];
      if (d._destroyed) continue;
      if (notme && d === self) continue;
      var db = MM.bbox(d);
      if (db && db.l <= r && db.r >= l && db.t <= b && db.b >= t) {
        if (!prec || !MM.maskOverlapsBox || MM.maskOverlapsBox(d, rect)) return d;
      }
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
  function tickAlarms(instList) {
    var list = instList || MM.state.instances;
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
      // Static scenery (most of the level) takes a fast path.
      if (!inst.gravity && !inst.friction && !inst.hspeed && !inst.vspeed) continue;
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
    if (def._levelSolid === undefined) {
      var sm = MM.objects['Solid_Mask'], bm = MM.objects['Break_Mask'];
      def._levelSolid = !!((sm && MM.objectChainHas(def, sm)) || (bm && MM.objectChainHas(def, bm)));
    }
    return def._levelSolid;
  }
  // 16:9 is still experimental (cut-scene anchors, backdrop seams) and is
  // only enabled by the page in test mode (?wide=1).  Default is the authored
  // 4:3 presentation.
  MM.aspect = '4:3';
  MM.setAspect = function (mode) {
    MM.aspect = (mode === '4:3') ? '4:3' : '16:9';
    if (MM.state.room) {
      // applyRoomView() re-reads the room defaults, which would snap the camera
      // back to the room start.  Keep the current camera position.
      var xv = MM.view.xview.slice(0, 8), yv = MM.view.yview.slice(0, 8);
      MM.applyRoomView(MM.state.room);
      for (var i = 0; i < 8; i++) {
        MM.view.xview[i] = xv[i] || 0;
        MM.view.yview[i] = yv[i] || 0;
      }
    }
    return MM.aspect;
  };

  MM.isLevelSolid = isLevelSolid;

  // Semantic kinds for level objects: floor / wall / ceiling / break / slope /
  // bridge / hazard.  Used by the debug overlay and by the QA bot; the physics
  // still uses the real masks.
  MM.kindOf = function (o) {
    if (!o) return 'other';
    var n = o.object_name || '';
    if (/Fire|Flame|Spike|Buzz|Laser|Lazer|Traktor|Saw|Bomb|Mine|SpikeBall|Lava/i.test(n)) return 'hazard';
    if (MM.maskSparseFor && MM.maskSparseFor(o)) return 'bridge';
    var def = o.object_index;
    var bm = MM.objects['Break_Mask'];
    if (bm && MM.objectChainHas(def, bm)) return 'break';
    if (MM.objects['objSlopeParent1'] && MM.objectChainHas(def, MM.objects['objSlopeParent1'])) return 'slope';
    var b = MM.bbox(o);
    if (!b) return 'other';
    var w = b.r - b.l + 1, h = b.b - b.t + 1;
    if (w >= h * 2) return 'floor';
    if (h >= w * 2) return 'wall';
    return 'block';
  };

  // Kind relative to a hero: wide solids above are ceilings, below are floors,
  // beside are walls.  This is what the overlay labels.
  MM.kindNear = function (o, hero) {
    var k = MM.kindOf(o);
    if (k !== 'floor' && k !== 'block' && k !== 'wall') return k;
    var b = MM.bbox(o), hb = hero && MM.bbox(hero);
    if (!b || !hb) return k;
    if (b.t >= hb.b - 4) return 'floor';
    if (b.b <= hb.t + 4) return 'ceiling';
    return 'wall';
  };

  // Static-ish list of level geometry, rebuilt only when instances are created
  // or destroyed (not every frame).  Contact queries used to scan all 1800+
  // instances on every ground probe.
  MM.levelSolids = function () {
    var st = MM.state;
    if (st._levelSolids && st._levelSolidsVersion === st.version) return st._levelSolids;
    var list = [];
    for (var i = 0; i < st.instances.length; i++) {
      var o = st.instances[i];
      if (o._destroyed || o._deactivated) continue;
      if (!isLevelSolid(o.object_index)) continue;
      // One-way bridges / slopes carry a precise silhouette; their own game
      // logic decides passage, the generic snap must leave them alone.
      if (MM.maskSparseFor && MM.maskSparseFor(o)) continue;
      list.push(o);
    }
    st._levelSolids = list;
    st._levelSolidsVersion = st.version;
    return list;
  };

  function overlapsLevelSolid(inst, x, y) {
    var box = MM.bbox(inst, x, y);
    if (!box) return false;
    var list = MM.levelSolids();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === inst || o._destroyed || o._deactivated) continue;
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
      // Vertical penetration first: landing must not touch horizontal speed.
      if (inst._py !== undefined && !overlapsLevelSolid(inst, inst.x, inst._py)) {
        inst.y = inst._py;
        inst.vspeed = 0;
        continue;
      }
      if (inst._px !== undefined && !overlapsLevelSolid(inst, inst._px, inst.y)) {
        inst.x = inst._px;
        MM.globals.vel = 0;
      }
      // Overlapping wall tiles (seams/corners) could leave no valid previous
      // position: search the nearest free spot so the hero can never stay
      // wedged inside geometry.
      if (overlapsLevelSolid(inst, inst.x, inst.y)) {
        for (var r = 1; r <= 24; r++) {
          var moved = false;
          var dirs = [[-r, 0], [r, 0], [0, -r], [0, r]];
          for (var di = 0; di < dirs.length; di++) {
            var nx = inst.x + dirs[di][0], ny = inst.y + dirs[di][1];
            if (!overlapsLevelSolid(inst, nx, ny)) {
              inst.x = nx; inst.y = ny;
              inst.vspeed = 0;
              MM.globals.vel = 0;
              moved = true;
              break;
            }
          }
          if (moved) break;
        }
      }
    }
    separatePlayerSides();
  }

  // A hero resting exactly against a wall (inclusive boxes) makes the game's
  // vertical probes touch that wall: the decompiled ground checks call
  // `place_meeting(x, bbox_bottom + 1, ...)`, which shifts the WHOLE mask down
  // one pixel, so a flush side contact is reported as solid ground.  Tails
  // refilled his flight stamina (`FlyTime = 225`) just by brushing a wall, and
  // the old code also cancelled jumps next to one.  Push the hero out to a one
  // pixel side clearance before collision events run, so the game never sees a
  // zero-pixel wall contact as ground.  Only shallow horizontal contacts are
  // touched: ledges keep their vertical landing.
  // States where touching a wall is meaningful to the original scripts
  // (glide->climb, punch, tornado, rolling/spindash wall breaking).  Those
  // need the real collision event, so the wall clearance must not run.
  function wallInteraction(p) {
    return !!(p.Punch || p.Glide || p.Climb || p.Climb2 || p.Tornado_Mode ||
              p.rolling || p.spindash);
  }

  function separatePlayerSides() {
    var list = MM.state.instances;
    for (var j = 0; j < list.length; j++) {
      var p = list[j];
      if (p._destroyed || p._deactivated || !isPlayerInst(p)) continue;
      if (wallInteraction(p)) continue;
      var pb = MM.bbox(p);
      if (!pb) continue;
      var solids = MM.levelSolids();
      for (var k = 0; k < solids.length; k++) {
        var o = solids[k];
        if (o === p || o._destroyed || o._deactivated) continue;
        var ob = MM.bbox(o);
        if (!ob) continue;
        if (pb.t >= ob.b || pb.b <= ob.t) continue; // no vertical overlap
        var dx = Math.min(pb.r, ob.r) - Math.max(pb.l, ob.l);
        var dy = Math.min(pb.b, ob.b) - Math.max(pb.t, ob.t);
        if (dx < 0 || dx > 2) continue; // gap, or deep inside (other resolver)
        if (dy < 6) continue;           // ledge / thin walkway: land normally
        if (pb.l + pb.r < ob.l + ob.r) {
          p.x -= dx + 1;
          if (MM.globals.vel > 0) MM.globals.vel = 0;
        } else {
          p.x += dx + 1;
          if (MM.globals.vel < 0) MM.globals.vel = 0;
        }
        pb = MM.bbox(p);
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
      // Cheap origin test first: a bbox always contains the origin, so an
      // instance well inside the room cannot be fully outside it.  This saved
      // a bbox computation (and mask lookup) for every scenery instance.
      if (inst.x > 0 && inst.x < room.w && inst.y > 0 && inst.y < room.h) continue;
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
      // GM draws in integer pixels; keeping the view fractional made every
      // HUD element that compensates with view_xview (SCORE/TIME/RINGS) shift
      // by one pixel every few frames while walking.  Snap the camera instead.
      MM.view.xview[i] = Math.round(Math.max(0, Math.min(vx, Math.max(0, room.w - w))));
      MM.view.yview[i] = Math.round(Math.max(0, Math.min(vy, Math.max(0, room.h - h))));
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

  function anyObjectHasEvent(name) {
    for (var k in MM.objects) {
      var d = MM.objects[k];
      if (!d || !d.events) continue;
      if (typeof d.events[name] === 'string' && d.events[name].length) return true;
    }
    return false;
  }

  // Per-frame event dispatch used to walk all ~1800 instances for step /
  // alarms / begin_step even though only a couple hundred define them.  Build
  // the per-event instance lists once per instance-version.
  function eventInstanceList(name) {
    var st = MM.state;
    var c = st._evLists || (st._evLists = {});
    var rec = c[name];
    if (rec && rec.v === st.version) return rec.list;
    var list = [];
    for (var i = 0; i < st.instances.length; i++) {
      var o = st.instances[i];
      if (o._destroyed) continue;
      if (MM.eventCode(o.object_index, name)) list.push(o);
    }
    c[name] = { v: st.version, list: list };
    return list;
  }

  function hasAnyAlarm(def) {
    if (!def) return false;
    if (def._hasAlarm === undefined) {
      var any = false;
      for (var a = 0; a < 12; a++) if (MM.eventCode(def, 'alarm' + a)) { any = true; break; }
      def._hasAlarm = any;
    }
    return def._hasAlarm;
  }

  function alarmInstanceList() {
    var st = MM.state;
    if (st._alarmList && st._alarmList.v === st.version) return st._alarmList.list;
    var list = [];
    for (var i = 0; i < st.instances.length; i++) {
      var o = st.instances[i];
      if (o._destroyed) continue;
      if (hasAnyAlarm(o.object_index)) list.push(o);
    }
    st._alarmList = { v: st.version, list: list };
    return list;
  }

  MM.step = function () {
    if (MM.loading && MM.loading.total) return;
    if (MM.state.paused) { MM.clearInputFrame(); return; }
    if (MM._hasBeginStep === undefined) {
      MM._hasBeginStep = anyObjectHasEvent('begin_step');
      MM._hasEndStep = anyObjectHasEvent('end_step');
    }
    MM.state.frame++;
    MM.state.frameInRoom++;
    var list;
    var i;

    list = MM.state.instances;
    for (i = 0; i < list.length; i++) {
      if (!list[i]._destroyed && isPlayerInst(list[i])) { list[i]._px = list[i].x; list[i]._py = list[i].y; }
    }
    if (MM._hasBeginStep) {
      var bl = eventInstanceList('begin_step').slice();
      for (i = 0; i < bl.length; i++) if (!bl[i]._destroyed) MM.runEvent(bl[i], 'begin_step');
    }
    tickAlarms(alarmInstanceList());
    var sl = eventInstanceList('step').slice();
    for (i = 0; i < sl.length; i++) if (!sl[i]._destroyed) MM.runEvent(sl[i], 'step');
    tickPhysics();
    tickPaths();
    tickOutsideRoom();
    // Keep flush wall contacts out of collision events (false "ground").
    separatePlayerSides();
    tickCollisions();
    resolvePlayerOverlap();
    if (MM._hasEndStep) {
      var el = eventInstanceList('end_step').slice();
      for (i = 0; i < el.length; i++) if (!el[i]._destroyed) MM.runEvent(el[i], 'end_step');
    }
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
      // 16:9: a camera view uses the full screen width, so the level is shown
      // wider instead of leaving strips outside the room.
      if (v.object && MM.aspect !== '4:3') {
        var wide = Math.round(MM.view.hview[i] * MM.VIEW_W / MM.VIEW_H);
        if (wide > MM.view.wview[i]) MM.view.wview[i] = wide;
      }
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

  // Tiles: sub-rect of a background image, positioned in world space.  Depth
  // decides whether the tile sits behind or in front of instances (GM sorts
  // everything by depth), so the renderer merges these with the instances.
  function drawRoomTile(ctx, t) {
    var img = MM.bgImage(t.i);
    if (!img || !img.width) return;
    var k = t.k == null ? 1 : t.k, l = t.l == null ? 1 : t.l;
    ctx.drawImage(img, t.sx, t.sy, t.w, t.h, t.x, t.y, t.w * k, t.h * l);
  }

  // Tile layers can be hidden/shown per depth (tile_layer_hide/show).  GHZ_7
  // hides its checkerboard back layers at the start and shows them again for
  // the corrupted "Bloody Hill" variant, so ignoring this call left the big
  // checker walls visible over the sky in Tails' intro.
  MM.tileLayerHidden = Object.create(null);
  MM.resetTileLayers = function (room) {
    var key = (room && room.name) || '';
    MM.tileLayerHidden[key] = Object.create(null);
  };
  MM.setTileLayerVisible = function (depth, visible) {
    var room = MM.state.room;
    if (!room) return;
    var key = room.name;
    var set = MM.tileLayerHidden[key] || (MM.tileLayerHidden[key] = Object.create(null));
    var d = Number(depth);
    if (visible) delete set[d];
    else set[d] = true;
  };
  MM.tileLayerHiddenAt = function (depth) {
    var room = MM.state.room;
    var set = room && MM.tileLayerHidden && MM.tileLayerHidden[room.name];
    return !!(set && set[Number(depth)]);
  };

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
    MM.resetTileLayers(room);
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
    // Tiles use background images as tilesets; start their loads immediately so
    // the first rendered frame is not full of holes.
    var rt = MM.roomTiles && MM.roomTiles[room.name];
    if (rt) {
      var tileSeen = {};
      for (var ti2 = 0; ti2 < rt.length; ti2++) {
        var tileUrl = rt[ti2].i;
        if (tileUrl && !tileSeen[tileUrl]) { tileSeen[tileUrl] = 1; MM.bgImage(tileUrl); }
      }
    }
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

  // Dialogue panel (SW, 380x96: portrait + black text box + "Enter" tab) is
  // wider than the 320-px view it was authored for.  Stretching the whole
  // sprite made the portrait and the frame look squashed.  Instead the panel
  // is drawn in three 1:1 slices: portrait, a stretched plain-black middle
  // (borders are horizontal, so they tile perfectly) and the "Enter" tab
  // pinned to the right edge of the visible view.
  function drawDialogPanel(ctx, cv, x, y) {
    var av = MM.activeView();
    var vw = Math.max(1, av.w);
    var H = cv.height;
    var leftW = Math.min(96, cv.width);
    var rightW = Math.min(110, Math.max(0, cv.width - leftW));
    var srcMid = cv.width - leftW - rightW;
    var midW = Math.max(1, Math.round(vw - leftW - rightW));
    var l = Math.round(x), t = Math.round(y);
    ctx.drawImage(cv, 0, 0, leftW, H, l, t, leftW, H);
    if (srcMid > 0) {
      ctx.drawImage(cv, leftW, 0, srcMid, H, l + leftW, t, midW, H);
    }
    if (rightW > 0) {
      ctx.drawImage(cv, cv.width - rightW, 0, rightW, H, l + leftW + midW, t, rightW, H);
    }
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
    if (!ang && !useTint && spr.w === 380 && spr.h === 96 &&
        typeof spr.name === 'string' && /^sprSW/.test(spr.name)) {
      drawDialogPanel(ctx, img, x, y);
      ctx.globalAlpha = prevAlpha;
      return;
    }
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
    // Backdrop objects (sky / hills / water) are placed for the authored 320-px
    // view.  In the wide 16:9 view their art can end inside the screen, which
    // showed up as a black band on one side and a visible edge on the other.
    // Extend the outer pixels of the backdrop into the margins so the picture
    // continues to the screen edge instead of stopping mid-screen.
    var spr = inst.sprite_index;
    if (!spr || !spr.frames) return;
    // Gameplay: only real backdrop layers (they sit behind everything).  Menu /
    // title screens are a single composition, so any wide art there counts.
    if (inst.depth < 100 && !(MM.isStaticArtRoom && MM.isStaticArtRoom())) return;
    if ((inst.image_angle || 0) !== 0) return;
    if (Math.abs(inst.image_xscale) !== 1 || Math.abs(inst.image_yscale) !== 1) return;
    var av = MM.activeView();
    var vL = av.x - (av.extra || 0), vR = vL + av.w;
    var b = MM.bbox(inst);
    if (!b || b.b < av.y || b.t > av.y + av.h) return;
    var cv = buildSpriteCanvas(spr, inst.image_index);
    // Only extend genuine backdrop art that covers most of the screen.  The
    // old "anything wide" rule also smeared menu titles/logos (the SELECT
    // LANGUAGE logo grew long horizontal streaks from its glow) because their
    // first/last few pixels were stretched into the margins.
    if (!cv || cv.width < 200 || cv.height < av.h * 0.5 || cv.width < av.w * 0.5) return;
    var gapL = b.l - vL, gapR = vR - b.r;
    var strip = 4;
    var prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = Math.max(0, Math.min(1, (inst.image_alpha == null ? 1 : inst.image_alpha) * prevAlpha));
    if (gapL > 1) {
      ctx.drawImage(cv, 0, 0, strip, cv.height, vL, b.t, gapL, b.b - b.t);
    }
    if (gapR > 1) {
      ctx.drawImage(cv, cv.width - strip, 0, strip, cv.height, b.r, b.t, gapR, b.b - b.t);
    }
    ctx.globalAlpha = prevAlpha;
  };

  var KIND_COLORS = {
    floor: '#39ff6a', wall: '#4aa3ff', ceiling: '#b06bff', block: '#8a8a9a',
    break: '#ff3b3b', hazard: '#ff9f1c', slope: '#ffe14d', bridge: '#00e5ff'
  };

  function drawKindOverlay(ctx, vx, vy, vw, vh) {
    var hero = null, i;
    for (i = 0; i < MM.state.instances.length; i++) {
      var hi = MM.state.instances[i];
      if (!hi._destroyed && hi.object_index && MM.objectChainHas(hi.object_index, MM.objects['Pers_Obj'])) { hero = hi; break; }
    }
    ctx.save();
    ctx.lineWidth = 1;
    for (i = 0; i < MM.state.instances.length; i++) {
      var o = MM.state.instances[i];
      if (o._destroyed || o._deactivated) continue;
      if (!MM.isLevelSolid(o.object_index) && MM.kindOf(o) === 'other') continue;
      var k = MM.kindNear(o, hero);
      if (k === 'other') continue;
      var b = MM.bbox(o);
      if (!b) continue;
      if (b.r < vx - 64 || b.l > vx + vw + 64 || b.b < vy - 64 || b.t > vy + vh + 64) continue;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = KIND_COLORS[k] || '#ffffff';
      ctx.strokeRect(b.l + 0.5, b.t + 0.5, Math.max(1, b.r - b.l), Math.max(1, b.b - b.t));
    }
    ctx.restore();
  }

  function drawKindLegend(ctx) {
    var items = [['floor', 'пол'], ['wall', 'стена'], ['ceiling', 'потолок'],
                 ['break', 'ломаемая'], ['hazard', 'опасность'], ['slope', 'склон'],
                 ['bridge', 'мост']];
    ctx.save();
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    var y = MM.VIEW_H - 9;
    for (var i = 0; i < items.length; i++) {
      var x = 8 + i * 118;
      ctx.fillStyle = KIND_COLORS[items[i][0]];
      ctx.fillRect(x, y - 8, 8, 8);
      ctx.fillStyle = '#dddddd';
      ctx.fillText(items[i][1], x + 11, y);
    }
    ctx.restore();
  }

  MM.renderFrame = function () {
    var ctx = MM.ctx;
    if (!ctx) return;
    var room = MM.state.room;
    if (!room) return;
    var W = MM.VIEW_W, H = MM.VIEW_H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Bars outside the authored view are always black.  The room's own bgcolor
    // is only painted inside the view rectangle (see below).
    ctx.fillStyle = '#000000';
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
    var ex = view.extra || 0;
    // Effective width of the visible game area, used by the HUD/cutscene
    // anchors so they sit on the real screen corners in every mode.
    if (!MM.globals) MM.globals = {};
    MM.globals.HUD_Wide = view.w;
    // Dialogue panels (SW) are laid out in the runtime's drawSprite with the
    // portrait and text at natural size; only the black middle is extended,
    // so the panel needs no extra offset/scale here.
    MM.globals.HUD_Dlg = 0;
    MM.globals.HUD_DlgScale = 1;
    var sx = Math.round(MM.fx.shakeX), sy = Math.round(MM.fx.shakeY);
    // The room background color belongs to the game view, not to the bars.
    if (view.px > 0 || view.py > 0 || view.pw < W || view.ph < H) {
      ctx.fillStyle = room.bgColor || '#000000';
      ctx.fillRect(view.px, view.py, view.pw, view.ph);
    }
    var drawables = MM.state.instances
      .filter(function (i) { return !i._destroyed && !i._deactivated && i.visible; })
      .slice()
      .sort(function (a, b) { return b.depth - a.depth; });
    var hudDrawables = drawables.filter(function (o) {
      return o.object_name === 'HUDer' || o.object_name === 'Timer';
    });
    // Screen-anchored UI pass: drawn with the camera pinned to 0 so camera
    // shake/rounding cannot make the score/lives/timer jitter.  It is inserted
    // exactly where the HUD objects sit in the depth order (before the
    // dialogue panel, which is the topmost layer), not after everything.
    var hudDrawn = false;
    var drawHudPass = function () {
      if (!hudDrawables.length) return;
      var hvx = MM.view.xview[0], hvy = MM.view.yview[0];
      MM.view.xview[0] = 0;
      MM.view.yview[0] = 0;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 1;
      ctx.setTransform(view.sx, 0, 0, view.sy,
        Math.round(view.px), Math.round(view.py));
      MM.gfxCtx = ctx;
      for (var hd = 0; hd < hudDrawables.length; hd++) {
        var hu = hudDrawables[hd];
        if (hu._destroyed) continue;
        if (MM.eventCode(hu.object_index, 'draw')) MM.runEvent(hu, 'draw');
        else if (hu.sprite_index) MM.gfx.drawSelf(ctx, hu);
      }
      ctx.restore();
      MM.gfxCtx = ctx;
      MM.view.xview[0] = hvx;
      MM.view.yview[0] = hvy;
    };

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // In 4:3 mode the world is only shown inside the 640x480 port: without this
    // clip the level tiles/sprites from outside the 320-wide view bled into the
    // side bars, which looked like broken backgrounds.
    if (view.px > 0 || view.pw < W || view.py > 0 || view.ph < H) {
      ctx.beginPath();
      ctx.rect(view.px, view.py, view.pw, view.ph);
      ctx.clip();
    }
    ctx.setTransform(view.sx, 0, 0, view.sy,
      Math.round(view.px - (vx - ex) * view.sx) + sx,
      Math.round(view.py - vy * view.sy) + sy);
    MM.gfxCtx = ctx;
    if (MM.gfx.drawBackgrounds) MM.gfx.drawBackgrounds(ctx, room, vx, vy, false);
    drawTileLayers(ctx, room, vx, vy);
    var tileDraw = [];
    var roomTiles = (MM.roomTiles && MM.roomTiles[room.name]) || null;
    if (roomTiles) {
      var tmg = 200;
      for (var tq = 0; tq < roomTiles.length; tq++) {
        var TQ = roomTiles[tq];
        var tw = TQ.w * (TQ.k == null ? 1 : TQ.k);
        var th = TQ.h * (TQ.l == null ? 1 : TQ.l);
        if (MM.tileLayerHiddenAt(TQ.d)) continue;          // tile_layer_hide(depth)
        if (TQ.x + tw < vx - tmg || TQ.x > vx + vw + tmg ||
            TQ.y + th < vy - tmg || TQ.y > vy + vh + tmg) continue;
        tileDraw.push(TQ);
      }
      tileDraw.sort(function (a, b) { return b.d - a.d; });
    }
    var tIdx = 0;
    for (var i = 0; i < drawables.length; i++) {
      var inst = drawables[i];
      while (tIdx < tileDraw.length && tileDraw[tIdx].d > inst.depth) drawRoomTile(ctx, tileDraw[tIdx++]);
      // Screen UI (score/lives/timer) is drawn in a separate stable pass, so
      // camera shake and sub-pixel scrolling cannot make it jitter.  Run it
      // here, at the HUD's place in the draw order.
      if (inst.object_name === 'HUDer' || inst.object_name === 'Timer') {
        if (!hudDrawn) { hudDrawn = true; drawHudPass(); }
        continue;
      }
      if (MM.eventCode(inst.object_index, 'draw')) {
        if (ex && inst.object_name === 'HUDer') {
          // The HUD compensates the camera with view_xview; keep it pinned to
          // the physical screen edge instead of the logical view edge.
          ctx.save();
          ctx.translate(-ex * view.sx, 0);
          MM.runEvent(inst, 'draw');
          ctx.restore();
        } else {
          MM.runEvent(inst, 'draw');
        }
      } else if (inst.sprite_index) {
        // отсечение за экраном для обычных спрайтовых объектов
        var spr = inst.sprite_index;
        var sw = spr.w * Math.abs(inst.image_xscale), shh = spr.h * Math.abs(inst.image_yscale);
        if (inst.x + sw < vx - ex - 64 || inst.x - sw > vx + vw + ex + 64 ||
            inst.y + shh < vy - 64 || inst.y - shh > vy + vh + 64) continue;
        MM.gfx.drawSelf(ctx, inst);
      }
    }
    while (tIdx < tileDraw.length) drawRoomTile(ctx, tileDraw[tIdx++]);
    if (MM.gfx.drawBackgrounds) MM.gfx.drawBackgrounds(ctx, room, vx, vy, true);
    if (MM.debugKinds) drawKindOverlay(ctx, vx, vy, vw, vh);
    ctx.restore();

    // Safety net: if the depth-ordered pass never reached the HUD objects
    // (e.g. a room where they are culled), draw it now.
    if (!hudDrawn) drawHudPass();

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
    if (MM.debugKinds) drawKindLegend(ctx);

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
      // Coming back from a hidden tab must not fast-forward the game: the old
      // 250 ms clamp still ran five steps every frame until the backlog was
      // gone (and could break timers/alarms).  Drop stale time instead.
      var syncClock = function () {
        last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        acc = 0;
      };
      // Returning to the tab: reset the clock and try to wake the audio device
      // (browsers suspend the AudioContext while the page is hidden).
      var wake = function () {
        syncClock();
        try { if (MM.audio && MM.audio.unlock) MM.audio.unlock(); } catch (e) { /* ignore */ }
      };
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', function () {
          if (typeof document.hidden !== 'undefined' && document.hidden) syncClock(); else wake();
        });
      }
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('blur', syncClock);
        window.addEventListener('focus', wake);
      }
      var lastLoop = 0;
      var nowMs = function () {
        return (typeof performance !== 'undefined' ? performance.now() : Date.now());
      };
      // One game step costs a few ms on a desktop and tens of ms on a weak
      // laptop.  Chasing the wall clock with a fixed five steps per frame turns
      // any slow frame into a cascade: the browser spends all its time in
      // script, rAF is delayed, more steps are queued...  (That looked like a
      // completely frozen browser while paging dialogue.)  Track the real step
      // cost and scale the catch-up budget down; on a very slow machine run a
      // single step per frame and simply let the game run slower.
      var stepCost = 6;
      var drive = function (t) {
        if (!MM.state.running) return;
        if (MM.state.paused) { last = t; acc = 0; return; }
        lastLoop = t;
        var dt = t - last; last = t;
        if (!(dt > 0) || dt > 250) dt = stepMs;
        acc += dt;
        var maxSteps = 5;
        if (stepCost > 22) maxSteps = 2;
        if (stepCost > 55) maxSteps = 1;
        var guard = 0;
        while (acc >= stepMs && guard++ < maxSteps) {
          var t0 = nowMs();
          MM.step();
          var d = nowMs() - t0;
          stepCost = stepCost * 0.8 + d * 0.2;
          if (d > 250) {
            MM._slow = {
              room: MM.state.room && MM.state.room.name,
              frame: MM.state.frame,
              ms: Math.round(d),
              page: (function () {
                var s = MM.query && MM.query('SW')[0];
                return s ? s.Page : null;
              })(),
              inst: MM.state.instances.length
            };
          }
          acc -= stepMs;
        }
        // Drop a backlog we cannot work off this frame instead of carrying it
        // forever (a slow device must not accumulate minutes of game time).
        if (acc > stepMs * 3) acc = 0;
        MM.renderFrame();
      };
      var loop = function (t) {
        try { drive(t); } catch (e) { if (!MM._loopErr) MM._loopErr = String(e && e.message); }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      // Watchdog: some embedded browsers/webviews throttle or stop rAF even
      // while the page is visible; without it the game looked frozen after the
      // loading screen disappeared.  It must stay a rare fallback: running the
      // normal loop from a timer while the real browser frame is merely slow
      // doubled the work per frame and could lock the page up.
      if (typeof setInterval === 'function') {
        var lastWatch = 0;
        setInterval(function () {
          if (!MM.state.running) return;
          if (typeof document !== 'undefined' && document.hidden) return;
          var now = nowMs();
          if (now - lastLoop <= 800) return;
          if (now - lastWatch < 700) return;
          lastWatch = now;
          try { drive(now); } catch (e) { if (!MM._loopErr) MM._loopErr = String(e && e.message); }
        }, 100);
      }
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
