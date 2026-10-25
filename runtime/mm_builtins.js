// =====================================================================
// MiniMaker — mm_builtins.js
// Встроенные функции (MM.builtins), константы (MM.constants) и
// глобальные переменные движка (MM.builtinVars) для языка MM Script.
// Подключается после mm_core.js и mm_interp.js.
// =====================================================================
(function () {
  'use strict';

  var MM = (globalThis.MM = globalThis.MM || {});
  var B = (MM.builtins = MM.builtins || {});
  var C = (MM.constants = MM.constants || {});

  // Full virtual-key table. The original set only had digits; the ported game
  // uses letters, function keys and the numpad.
  var VK_EXTRA = {
    vk_backquote: 192, vk_tilde: 192, vk_quote: 222, vk_slash: 191, vk_backslash: 220,
    vk_semicolon: 186, vk_comma: 188, vk_period: 190, vk_slash2: 191,
    vk_bracketleft: 219, vk_bracketright: 221, vk_equal: 187,
    vk_f1: 112, vk_f2: 113, vk_f3: 114, vk_f4: 115, vk_f5: 116, vk_f6: 117,
    vk_f7: 118, vk_f8: 119, vk_f9: 120, vk_f10: 121, vk_f11: 122, vk_f12: 123,
    vk_numpad0: 96, vk_numpad1: 97, vk_numpad2: 98, vk_numpad3: 99, vk_numpad4: 100,
    vk_numpad5: 101, vk_numpad6: 102, vk_numpad7: 103, vk_numpad8: 104, vk_numpad9: 105,
    vk_multiply: 106, vk_add: 107, vk_subtract: 109, vk_decimal: 110, vk_divide: 111,
    vk_insert: 45, vk_home: 36, vk_pageup: 33, vk_delete: 46, vk_end: 35, vk_pagedown: 34,
    vk_lshift: 16, vk_lcontrol: 17, vk_lalt: 18, vk_lsuper: 91,
    vk_rshift: 16, vk_rcontrol: 17, vk_ralt: 18, vk_rsuper: 92,
    vk_capslock: 20, vk_scrolllock: 145, vk_pause: 19, vk_printscreen: 44,
    vk_nokey: 0
  };
  for (var k in VK_EXTRA) C[k] = VK_EXTRA[k];
  // letters A-Z
  for (var li = 0; li < 26; li++) C['vk_' + String.fromCharCode(97 + li)] = 65 + li;
  var V = (MM.builtinVars = MM.builtinVars || {});

  // -------------------------------------------------------------------
  // Генератор случайных чисел (детерминируемый — удобно для тестов)
  // -------------------------------------------------------------------
  var rngState = 1337;
  function rnd() {
    rngState |= 0;
    rngState = (rngState + 0x6D2B79F5) | 0;
    var t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  MM.rng = rnd;
  MM.randomize = function () { rngState = (Date.now() ^ (Math.random() * 0xffffffff)) | 0; };
  MM.randomSetSeed = function (n) { rngState = n | 0; };

  // -------------------------------------------------------------------
  // Утилиты
  // -------------------------------------------------------------------
  function num(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var n = Number(v); return isNaN(n) ? 0 : n; }
    return v ? 1 : 0;
  }
  function str(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      return String(parseFloat(v.toFixed(6)));
    }
    if (v === true) return '1';
    if (v === false || v == null) return '0';
    if (v instanceof MM.Instance) return '<instance ' + v.id + ' ' + v.object_name + '>';
    return '<object>';
  }
  // GM-цвет (BGR-число) или строка '#rrggbb'
  function gmColor(v) {
    if (typeof v === 'string') return v;
    var n = v | 0;
    var r = n & 0xff, g = (n >> 8) & 0xff, b = (n >> 16) & 0xff;
    return '#' + [r, g, b].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function sctx() {
    var ctx = MM.gfxCtx;
    if (ctx) {
      ctx.globalAlpha = Math.max(0, Math.min(1, MM.gfx.alpha));
      ctx.globalCompositeOperation = MM.gfx.blend === 'add' ? 'lighter' : 'source-over';
    }
    return ctx;
  }
  function self(ctx) { return ctx && ctx.self instanceof MM.Instance ? ctx.self : null; }

  // -------------------------------------------------------------------
  // МАТЕМАТИКА
  // -------------------------------------------------------------------
  B.random = function (c, a) { return rnd() * (a.length ? num(a[0]) : 1); };
  B.random_range = function (c, a) { return num(a[0]) + rnd() * (num(a[1]) - num(a[0])); };
  B.irandom = function (c, a) { var n = Math.floor(num(a[0])); return n <= 0 ? 0 : Math.floor(rnd() * (n + 1)); };
  B.irandom_range = function (c, a) {
    var lo = Math.floor(num(a[0])), hi = Math.floor(num(a[1]));
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    return lo + Math.floor(rnd() * (hi - lo + 1));
  };
  B.choose = function (c, a) { return a.length ? a[Math.floor(rnd() * a.length)] : 0; };
  B.min = function (c, a) { var m = num(a[0]); for (var i = 1; i < a.length; i++) m = Math.min(m, num(a[i])); return m; };
  B.max = function (c, a) { var m = num(a[0]); for (var i = 1; i < a.length; i++) m = Math.max(m, num(a[i])); return m; };
  B.abs = function (c, a) { return Math.abs(num(a[0])); };
  B.sign = function (c, a) { return Math.sign(num(a[0])); };
  B.floor = function (c, a) { return Math.floor(num(a[0])); };
  B.ceil = function (c, a) { return Math.ceil(num(a[0])); };
  B.round = function (c, a) { return Math.round(num(a[0])); };
  B.sqrt = function (c, a) { return Math.sqrt(Math.max(0, num(a[0]))); };
  B.sqr = function (c, a) { return num(a[0]) * num(a[0]); };
  B.power = function (c, a) { return Math.pow(num(a[0]), num(a[1])); };
  B.sin = function (c, a) { return Math.sin(num(a[0]) * Math.PI / 180); };
  B.cos = function (c, a) { return Math.cos(num(a[0]) * Math.PI / 180); };
  B.tan = function (c, a) { return Math.tan(num(a[0]) * Math.PI / 180); };
  B.arctan = function (c, a) { return Math.atan(num(a[0])) * 180 / Math.PI; };
  B.arctan2 = function (c, a) { return Math.atan2(num(a[0]), num(a[1])) * 180 / Math.PI; };
  B.degtorad = function (c, a) { return num(a[0]) * Math.PI / 180; };
  B.radtodeg = function (c, a) { return num(a[0]) * 180 / Math.PI; };
  B.point_distance = function (c, a) {
    var dx = num(a[2]) - num(a[0]), dy = num(a[3]) - num(a[1]);
    return Math.sqrt(dx * dx + dy * dy);
  };
  B.point_direction = function (c, a) {
    var d = Math.atan2(-(num(a[3]) - num(a[1])), num(a[2]) - num(a[0])) * 180 / Math.PI;
    if (d < 0) d += 360;
    return d;
  };
  B.lengthdir_x = function (c, a) { return Math.cos(num(a[0]) * Math.PI / 180) * num(a[1]); };
  B.lengthdir_y = function (c, a) { return -Math.sin(num(a[0]) * Math.PI / 180) * num(a[1]); };
  B.clamp = function (c, a) { return Math.max(num(a[1]), Math.min(num(a[2]), num(a[0]))); };
  B.lerp = function (c, a) { return num(a[0]) + (num(a[1]) - num(a[0])) * num(a[2]); };
  B.approach = function (c, a) {
    var v = num(a[0]), t = num(a[1]), s = num(a[2]);
    return v < t ? Math.min(v + s, t) : Math.max(v - s, t);
  };
  B.randomize = function () { MM.randomize(); return 0; };
  B.random_set_seed = function (c, a) { MM.randomSetSeed(num(a[0])); return 0; };
  B.frac = function (c, a) { var v = num(a[0]); return v - Math.trunc(v); };

  // -------------------------------------------------------------------
  // СТРОКИ
  // -------------------------------------------------------------------
  B.string = function (c, a) { return str(a[0]); };
  B.real = function (c, a) { return num(a[0]); };
  B.string_length = function (c, a) { return str(a[0]).length; };
  B.string_char_at = function (c, a) { return str(a[0])[num(a[1]) - 1] || ''; };
  B.string_copy = function (c, a) {
    var s = str(a[0]), i = Math.max(1, Math.floor(num(a[1]))) - 1;
    var len = a.length > 2 ? Math.floor(num(a[2])) : s.length - i;
    return s.substr(i, Math.max(0, len));
  };
  B.string_pos = function (c, a) { return str(a[1]).indexOf(str(a[0])) + 1; };
  B.string_upper = function (c, a) { return str(a[0]).toUpperCase(); };
  B.string_lower = function (c, a) { return str(a[0]).toLowerCase(); };
  B.string_delete = function (c, a) {
    var s = str(a[0]), i = Math.max(1, Math.floor(num(a[1]))) - 1, len = Math.floor(num(a[2]));
    return s.slice(0, i) + s.slice(i + len);
  };
  B.string_insert = function (c, a) {
    var s = str(a[0]), sub = str(a[1]), i = Math.max(0, Math.floor(num(a[2])) - 1);
    return s.slice(0, i) + sub + s.slice(i);
  };
  B.string_repeat = function (c, a) {
    var s = str(a[0]), n = Math.max(0, Math.floor(num(a[1]))), out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  };
  B.chr = function (c, a) { return String.fromCharCode(num(a[0])); };
  B.ord = function (c, a) { return str(a[0]).charCodeAt(0) || 0; };

  // -------------------------------------------------------------------
  // МАССИВЫ (расширения MiniMaker)
  // -------------------------------------------------------------------
  B.array_length = function (c, a) { return Array.isArray(a[0]) ? a[0].length : 0; };
  B.array_create = function (c, a) {
    var n = Math.max(0, Math.floor(num(a[0]))), v = a.length > 1 ? a[1] : 0, out = [];
    for (var i = 0; i < n; i++) out.push(v);
    return out;
  };
  B.array_push = function (c, a) { if (Array.isArray(a[0])) a[0].push(a[1]); return 0; };

  // -------------------------------------------------------------------
  // ИНСТАНСЫ
  // -------------------------------------------------------------------
  B.instance_create = function (c, a) {
    var inst = MM.instanceCreate(num(a[0]), num(a[1]), a[2]);
    return inst || MM.NOONE;
  };
  B.instance_destroy = function (c, a) {
    var target = a.length ? a[0] : (c.self instanceof MM.Instance ? c.self : null);
    if (target instanceof MM.Instance) MM.instanceDestroy(target);
    else MM.query(target).forEach(function (i) { MM.instanceDestroy(i); });
    return 0;
  };
  B.instance_exists = function (c, a) { return MM.query(a[0]).length > 0 ? 1 : 0; };
  B.instance_number = function (c, a) { return MM.query(a[0]).length; };
  B.instance_find = function (c, a) {
    var list = MM.query(a[0]);
    var i = Math.floor(num(a[1]));
    return list[i] || MM.NOONE;
  };
  B.instance_nearest = function (c, a) {
    var x = num(a[0]), y = num(a[1]), list = MM.query(a[2]);
    var best = null, bd = 1e18;
    for (var i = 0; i < list.length; i++) {
      var d = (list[i].x - x) * (list[i].x - x) + (list[i].y - y) * (list[i].y - y);
      if (d < bd) { bd = d; best = list[i]; }
    }
    return best || MM.NOONE;
  };
  B.instance_position = function (c, a) {
    var x = num(a[0]), y = num(a[1]), list = MM.query(a[2]);
    for (var i = 0; i < list.length; i++) {
      var b = MM.bbox(list[i]);
      if (b && x >= b.l && x <= b.r && y >= b.t && y <= b.b) return list[i];
    }
    return MM.NOONE;
  };
  B.instance_place = function (c, a) {
    var me = self(c);
    if (!me) return MM.NOONE;
    return MM.instancePlace(me, num(a[0]), num(a[1]), a[2]);
  };
  B.place_meeting = function (c, a) {
    var me = self(c);
    if (!me) return 0;
    return MM.placeMeeting(me, num(a[0]), num(a[1]), a[2]) ? 1 : 0;
  };
  B.position_meeting = function (c, a) {
    return B.instance_position(c, a) !== MM.NOONE ? 1 : 0;
  };
  B.collision_rectangle = function (c, a) {
    var r = MM.collisionRectangle(num(a[0]), num(a[1]), num(a[2]), num(a[3]), a[4], num(a[6]) !== 0, num(a[5]) !== 0);
    return r === MM.NOONE ? 0 : 1;
  };
  B.distance_to_object = function (c, a) {
    var me = self(c);
    if (!me) return 100000;
    return MM.distanceToObject(me, a[0]);
  };
  B.distance_to_point = function (c, a) {
    var me = self(c);
    if (!me) return 100000;
    var px = num(a[0]), py = num(a[1]);
    // GML measures from the instance's bounding box, not from its origin, and
    // returns 0 while the point is inside the mask.
    var b = MM.bbox(me);
    if (!b) {
      var dx0 = px - me.x, dy0 = py - me.y;
      return Math.sqrt(dx0 * dx0 + dy0 * dy0);
    }
    var dx = px < b.l ? b.l - px : (px > b.r ? px - b.r : 0);
    var dy = py < b.t ? b.t - py : (py > b.b ? py - b.b : 0);
    return Math.sqrt(dx * dx + dy * dy);
  };
  B.move_towards_point = function (c, a) {
    var me = self(c);
    if (!me) return 0;
    var d = B.point_direction(c, [me.x, me.y, num(a[0]), num(a[1])]);
    // GML sets direction+speed, i.e. it rewrites hspeed/vspeed.
    MM.motionSet(me, d, num(a[2]));
    return 0;
  };
  B.motion_set = function (c, a) {
    var me = self(c);
    if (me) MM.motionSet(me, num(a[0]), num(a[1]));
    return 0;
  };
  B.motion_add = function (c, a) {
    var me = self(c);
    if (me) MM.motionAdd(me, num(a[0]), num(a[1]));
    return 0;
  };
  // move_contact_solid is level geometry only.  Springs/interactive props are
  // flagged solid in the original too, but treating them as walls made the
  // ground snap shove the hero tens of pixels out of them ("я иду сквозь
  // пружины" / телепорты у стен).
  function touchesSolid(inst, x, y) {
    var box = MM.bbox(inst, x, y);
    if (!box) return false;
    var list = MM.levelSolids ? MM.levelSolids() : MM.state.instances;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === inst || o._destroyed || o._deactivated) continue;
      if (MM.isLevelSolid && !MM.isLevelSolid(o.object_index)) continue;
      var ob = MM.bbox(o);
      if (ob && box.l <= ob.r && box.r >= ob.l && box.t <= ob.b && box.b >= ob.t) return true;
    }
    return false;
  }

  B.move_contact_solid = function (c, a) {
    var me = self(c);
    if (!me) return 0;
    var dir = num(a[0]), maxDist = num(a[1]);
    if (!(maxDist > 0)) maxDist = 1000;
    var dx = Math.cos(dir * Math.PI / 180), dy = -Math.sin(dir * Math.PI / 180);
    var steps = 0;
    // GM's move_contact_solid is also the game's "un-sink" tool: when the
    // instance already overlaps a solid it moves it BACK along -dir until it
    // is free (Tails/Knuckles call it right after a landing).  Without this the
    // player stayed a few pixels inside the floor and could not walk; with an
    // extra pixel it hovered and jittered.
    if (touchesSolid(me, me.x, me.y)) {
      // Only undo penetration along the requested axis and only against the
      // surface the hero actually came through: a downward snap pops him onto
      // the floor, an upward one drops him off a ceiling.  The old back-off
      // loop also walked him up tall walls ("стены выталкивают").
      var vbox = MM.bbox(me);
      if (!vbox) return 0;
      var solids = MM.levelSolids();
      var pen = 0, found = false;
      for (var si = 0; si < solids.length; si++) {
        var so = solids[si];
        if (so === me || so._destroyed || so._deactivated) continue;
        var sb = MM.bbox(so);
        if (!sb) continue;
        if (vbox.l > sb.r || vbox.r < sb.l) continue;
        if (dy > 0) {
          var p = vbox.b - sb.t;
          if (p >= 0 && p <= 32) { found = true; if (p > pen) pen = p; }
        } else if (dy < 0) {
          var p2 = sb.b - vbox.t;
          if (p2 >= 0 && p2 <= 32) { found = true; if (p2 > pen) pen = p2; }
        }
      }
      // Also normalise "standing exactly on the surface" (pen = 0) to a one
      // pixel gap: GM's inclusive boxes otherwise report the floor as a wall
      // for every probe at the same height (that cancelled the spindash).
      if (found) { me.y -= (dy > 0 ? pen + 1 : -(pen + 1)); }
      return 0;
    }
    // GameMaker advances in whole pixels and never exceeds maxdist, so
    // move_contact_solid(direction, 0.1) is a no-op (the game uses it just to
    // snap against walls); the old loop still moved a full pixel there.
    while (steps + 1 <= maxDist + 1e-9) {
      if (touchesSolid(me, me.x + dx, me.y + dy)) break;
      me.x += dx; me.y += dy;
      steps++;
    }
    return 0;
  };
  B.instance_change = function (c, a) {
    // GML: instance_change(obj, perf) morphs the instance into another object
    // in place.  The rings depend on it (Ring -> RingOut, which then plays its
    // animation and destroys itself) -- as a no-op every collected ring stayed
    // in the room forever.
    var me = self(c);
    if (!me) return 0;
    var def = MM.resolveObject(a[0]);
    if (!def) return 0;
    var perf = a.length > 1 ? (num(a[1]) !== 0) : true;
    var oldDef = me.object_index;
    var oldName = me.object_name;
    me.object_index = def;
    me.object_name = def.name;
    me.sprite_index = def.sprite ? MM.resolveSprite(def.sprite) : null;
    me.mask_index = null;
    me.visible = def.visible !== false;
    me.solid = !!def.solid;
    me.depth = def.depth || 0;
    me._bboxCache = null;
    MM.state.version++;
    if (perf) {
      var dcode = MM.eventCode(oldDef, 'destroy');
      if (dcode) MM.interp.run(dcode, { self: me, other: MM.NOONE, name: oldName + ':destroy' });
      var ccode = MM.eventCode(def, 'create');
      if (ccode) MM.interp.run(ccode, { self: me, other: MM.NOONE, name: def.name + ':create' });
    }
    return 0;
  };
  B.sprite_get_width = function (c, a) { var s = MM.resolveSprite(a[0]); return s ? s.w : 0; };
  B.sprite_get_height = function (c, a) { var s = MM.resolveSprite(a[0]); return s ? s.h : 0; };
  B.sprite_get_number = function (c, a) { var s = MM.resolveSprite(a[0]); return s ? s.frames.length : 0; };

  // -------------------------------------------------------------------
  // КОМНАТЫ
  // -------------------------------------------------------------------
  B.room_goto = function (c, a) { MM.roomGoto(a[0]); return 0; };
  B.room_restart = function () { MM.roomRestart(); return 0; };
  B.game_restart = function () { MM.gameRestart(); return 0; };
  B.room_goto_next = function () {
    var keys = Object.keys(MM.rooms);
    var cur = MM.state.room ? MM.state.room.name : null;
    var i = keys.indexOf(cur);
    MM.roomGoto(keys[(i + 1) % keys.length]);
    return 0;
  };
  B.room_exists = function (c, a) { return (typeof a[0] === 'string' ? MM.rooms[a[0]] : a[0]) ? 1 : 0; };
  B.room_get_name = function () { return MM.state.room ? MM.state.room.name : ''; };
  B.game_pause = function (c, a) { MM.state.paused = num(a[0]) ? true : false; return 0; };
  B.game_is_paused = function () { return MM.state.paused ? 1 : 0; };

  // -------------------------------------------------------------------
  // ВВОД
  // -------------------------------------------------------------------
  B.keyboard_check = function (c, a) { return MM.input.keys[num(a[0])] ? 1 : 0; };
  B.keyboard_check_pressed = function (c, a) { return MM.input.pressed[num(a[0])] ? 1 : 0; };
  B.keyboard_check_released = function (c, a) { return MM.input.released[num(a[0])] ? 1 : 0; };
  B.keyboard_clear = function (c, a) { MM.input.keys[num(a[0])] = false; return 0; };
  B.keyboard_lastkey_get = function () { return MM.input.lastKey; };
  B.mouse_check_button = function (c, a) {
    var b = num(a[0]);
    var dom = b === 1 ? 0 : (b === 2 ? 2 : (b === 3 ? 1 : b));
    return MM.input.buttons[dom] ? 1 : 0;
  };
  B.mouse_check_button_pressed = function (c, a) {
    var b = num(a[0]);
    var dom = b === 1 ? 0 : (b === 2 ? 2 : (b === 3 ? 1 : b));
    return MM.input.btnPressed[dom] ? 1 : 0;
  };
  B.any_key_pressed = function () { return MM.input.anyKeyPressed ? 1 : 0; };

  // -------------------------------------------------------------------
  // ЗВУК
  // -------------------------------------------------------------------
  function soundName(snd) {
    if (typeof snd === 'string') return snd;
    if (snd && snd.name) return snd.name;
    return null;
  }
  B.sound_play = function (c, a) { var n = soundName(a[0]); if (n && MM.audio) MM.audio.sfx(n); return 0; };
  B.sound_loop = B.sound_play;
  B.sound_stop_all = function () { if (MM.audio) MM.audio.stopAllSfx(); return 0; };
  B.music_play = function (c, a) { var n = soundName(a[0]); if (n && MM.audio) MM.audio.music(n); return 0; };
  B.music_stop = function () { if (MM.audio) MM.audio.stopMusic(); return 0; };
  B.audio_unlock = function () { if (MM.audio) MM.audio.init(); return 0; };
  B.audio_ready = function () { return MM.audio && MM.audio.isReady() ? 1 : 0; };
  B.set_sfx_volume = function (c, a) { if (MM.audio) MM.audio.setSfxVolume(num(a[0])); return 0; };
  B.set_music_volume = function (c, a) { if (MM.audio) MM.audio.setMusicVolume(num(a[0])); return 0; };

  // -------------------------------------------------------------------
  // ЭФФЕКТЫ
  // -------------------------------------------------------------------
  B.fx_shake = function (c, a) { MM.fxShake(num(a[0]), num(a[1])); return 0; };
  B.fx_flash = function (c, a) { MM.fxFlash(gmColor(a[0]), num(a[1]), a.length > 2 ? num(a[2]) : 1); return 0; };
  B.fx_overlay = function (c, a) { MM.fxOverlay(gmColor(a[0]), num(a[1])); return 0; };
  B.fx_scanlines = function (c, a) { MM.fxScanlines(num(a[0])); return 0; };

  // -------------------------------------------------------------------
  // ОТРИСОВКА (используется внутри событий draw / draw_gui)
  // -------------------------------------------------------------------
  B.draw_self = function (c) {
    var ctx = sctx(), me = self(c);
    if (ctx && me) MM.gfx.drawSelf(ctx, me);
    return 0;
  };
  B.draw_sprite = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var spr = MM.resolveSprite(a[0]);
    var sub = num(a[1]);
    var me = self(c);
    if (sub < 0 && me) sub = me.image_index;
    MM.gfx.drawSprite(ctx, spr, sub, num(a[2]), num(a[3]), {});
    return 0;
  };
  B.draw_sprite_ext = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var spr = MM.resolveSprite(a[0]);
    var sub = num(a[1]);
    var me = self(c);
    if (sub < 0 && me) sub = me.image_index;
    MM.gfx.drawSprite(ctx, spr, sub, num(a[2]), num(a[3]), {
      xscale: num(a[4]) || 1, yscale: num(a[5]) || 1,
      angle: num(a[6]), blend: gmColor(a[7]), alpha: a.length > 8 ? num(a[8]) : 1
    });
    return 0;
  };
  B.draw_sprite_stretched = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var spr = MM.resolveSprite(a[0]);
    if (!spr) return 0;
    var cv = MM.spriteCanvas(spr, Math.floor(num(a[1])) < 0 ? 0 : Math.floor(num(a[1])));
    if (!cv) return 0;
    var x = num(a[2]), y = num(a[3]), w = num(a[4]), h = num(a[5]);
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = MM.gfx.alpha;
    ctx.drawImage(cv, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    ctx.globalAlpha = prev;
    return 0;
  };
  B.draw_text = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var size = MM.FONT_SIZES[MM.gfx.font] || 10;
    ctx.font = size + 'px "Lucida Console", Consolas, monospace';
    ctx.fillStyle = MM.gfx.color;
    ctx.textAlign = MM.gfx.halign === 1 ? 'center' : (MM.gfx.halign === 2 ? 'right' : 'left');
    ctx.textBaseline = MM.gfx.valign === 1 ? 'middle' : (MM.gfx.valign === 2 ? 'bottom' : 'top');
    ctx.fillText(str(a[2]), Math.round(num(a[0])), Math.round(num(a[1])));
    return 0;
  };
  B.draw_text_ext = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var text = str(a[2]);
    var sep = num(a[3]) || 14;
    var width = num(a[4]) || 200;
    var size = MM.FONT_SIZES[MM.gfx.font] || 10;
    ctx.font = size + 'px "Lucida Console", Consolas, monospace';
    ctx.fillStyle = MM.gfx.color;
    ctx.textAlign = MM.gfx.halign === 1 ? 'center' : (MM.gfx.halign === 2 ? 'right' : 'left');
    ctx.textBaseline = 'top';
    var perLine = Math.max(1, Math.floor(width / (size * 0.62)));
    var lines = [];
    var paras = text.split('\n');
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(' ');
      var line = '';
      for (var w = 0; w < words.length; w++) {
        var test = line ? line + ' ' + words[w] : words[w];
        if (test.length > perLine && line) { lines.push(line); line = words[w]; }
        else line = test;
      }
      lines.push(line);
    }
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], Math.round(num(a[0])), Math.round(num(a[1]) + i * sep));
    }
    return 0;
  };
  B.draw_set_color = function (c, a) { MM.gfx.color = gmColor(a[0]); return 0; };
  B.draw_set_alpha = function (c, a) { MM.gfx.alpha = num(a[0]); return 0; };
  B.draw_set_halign = function (c, a) { MM.gfx.halign = num(a[0]); return 0; };
  B.draw_set_valign = function (c, a) { MM.gfx.valign = num(a[0]); return 0; };
  B.draw_set_font = function (c, a) { MM.gfx.font = num(a[0]); return 0; };
  B.draw_set_blend_mode = function (c, a) { MM.gfx.blend = num(a[0]) === 1 ? 'add' : 'normal'; return 0; };
  B.draw_rectangle = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var x1 = num(a[0]), y1 = num(a[1]), x2 = num(a[2]), y2 = num(a[3]);
    if (num(a[4])) {
      ctx.strokeStyle = MM.gfx.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x1) + 0.5, Math.round(y1) + 0.5, Math.round(x2 - x1), Math.round(y2 - y1));
    } else {
      ctx.fillStyle = MM.gfx.color;
      ctx.fillRect(Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1));
    }
    return 0;
  };
  B.draw_circle = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    ctx.beginPath();
    ctx.arc(num(a[0]), num(a[1]), Math.max(0, num(a[2])), 0, Math.PI * 2);
    if (num(a[3])) { ctx.strokeStyle = MM.gfx.color; ctx.lineWidth = 1; ctx.stroke(); }
    else { ctx.fillStyle = MM.gfx.color; ctx.fill(); }
    return 0;
  };
  B.draw_line = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    ctx.strokeStyle = MM.gfx.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(num(a[0])) + 0.5, Math.round(num(a[1])) + 0.5);
    ctx.lineTo(Math.round(num(a[2])) + 0.5, Math.round(num(a[3])) + 0.5);
    ctx.stroke();
    return 0;
  };
  B.draw_triangle = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    ctx.beginPath();
    ctx.moveTo(num(a[0]), num(a[1]));
    ctx.lineTo(num(a[2]), num(a[3]));
    ctx.lineTo(num(a[4]), num(a[5]));
    ctx.closePath();
    if (num(a[6])) { ctx.strokeStyle = MM.gfx.color; ctx.lineWidth = 1; ctx.stroke(); }
    else { ctx.fillStyle = MM.gfx.color; ctx.fill(); }
    return 0;
  };
  B.draw_gradient_rect = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var x1 = num(a[0]), y1 = num(a[1]), x2 = num(a[2]), y2 = num(a[3]);
    var vertical = a.length > 6 ? num(a[6]) : 1;
    var g = vertical
      ? ctx.createLinearGradient(0, y1, 0, y2)
      : ctx.createLinearGradient(x1, 0, x2, 0);
    g.addColorStop(0, gmColor(a[4]));
    g.addColorStop(1, gmColor(a[5]));
    var prev = ctx.globalAlpha;
    ctx.globalAlpha = MM.gfx.alpha;
    ctx.fillStyle = g;
    ctx.fillRect(Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1));
    ctx.globalAlpha = prev;
    return 0;
  };
  B.draw_vignette = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var alpha = num(a[0]);
    var w = MM.VIEW_W, h = MM.VIEW_H;
    var g = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + Math.max(0, Math.min(1, alpha)) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return 0;
  };
  B.draw_healthbar = function (c, a) {
    var ctx = sctx();
    if (!ctx) return 0;
    var x1 = num(a[0]), y1 = num(a[1]), x2 = num(a[2]), y2 = num(a[3]);
    var amount = Math.max(0, Math.min(100, num(a[4])));
    var w = x2 - x1;
    var prevA = ctx.globalAlpha;
    ctx.globalAlpha = MM.gfx.alpha;
    ctx.fillStyle = gmColor(a[6] != null ? a[6] : 8421504);
    ctx.fillRect(x1, y1, w, y2 - y1);
    ctx.fillStyle = gmColor(a[8] != null ? a[8] : 65280);
    ctx.fillRect(x1, y1, w * amount / 100, y2 - y1);
    ctx.globalAlpha = prevA;
    return 0;
  };

  // -------------------------------------------------------------------
  // ПРОЧЕЕ
  // -------------------------------------------------------------------
  B.show_debug_message = function (c, a) {
    if (typeof console !== 'undefined') console.log('[MM]', str(a[0]));
    return 0;
  };
  B.script_execute = function (c, a) {
    var name = a[0];
    if (typeof name === 'function' && name.mmScript) return name(c, a.slice(1));
    if (typeof name === 'number') {
      var keys = Object.keys(MM.scripts);
      name = keys[name];
    }
    if (typeof name === 'string' && MM.scripts[name] != null) {
      return MM.interp.runScript(name, c.self, c.other, a.slice(1));
    }
    MM.warn('script_execute: нет скрипта ' + str(a[0]));
    return 0;
  };
  B.event_perform = function () { return 0; };
  B.instance_id = function (c) { var m = self(c); return m ? m.id : MM.NOONE; };

  // -------------------------------------------------------------------
  // КОНСТАНТЫ
  // -------------------------------------------------------------------
  C.vk_backspace = 8; C.vk_tab = 9; C.vk_enter = 13; C.vk_shift = 16;
  C.vk_control = 17; C.vk_alt = 18; C.vk_escape = 27; C.vk_space = 32;
  C.vk_left = 37; C.vk_up = 38; C.vk_right = 39; C.vk_down = 40;
  C.vk_0 = 48; C.vk_1 = 49; C.vk_2 = 50; C.vk_3 = 51; C.vk_4 = 52;
  C.vk_5 = 53; C.vk_6 = 54; C.vk_7 = 55; C.vk_8 = 56; C.vk_9 = 57;
  for (var i = 0; i < 26; i++) C['vk_' + String.fromCharCode(65 + i)] = 65 + i;
  for (var n2 = 0; n2 < 10; n2++) C['vk_numpad' + n2] = 96 + n2;
  for (var f = 1; f <= 12; f++) C['vk_f' + f] = 111 + f;
  C.vk_alt_enter = null; delete C['vk_alt_enter'];

  C.c_aqua = 16776960; C.c_black = 0; C.c_blue = 16711680; C.c_dkgray = 4210752;
  C.c_fuchsia = 16711935; C.c_gray = 8421504; C.c_green = 65280;
  C.c_lime = 65280; C.c_ltgray = 12632256; C.c_maroon = 128; C.c_navy = 8388608;
  C.c_olive = 32896; C.c_orange = 4235519; C.c_purple = 8388736;
  C.c_red = 255; C.c_silver = 12632256; C.c_teal = 8421376; C.c_white = 16777215;
  C.c_yellow = 65535;
  C.mb_left = 1; C.mb_right = 2; C.mb_middle = 3;
  C.bm_normal = 0; C.bm_add = 1; C.bm_subtract = 2; C.bm_max = 3;
  C.fa_left = 0; C.fa_center = 1; C.fa_right = 2;  C.fa_top = 0; C.fa_middle = 1; C.fa_bottom = 2;
  C.path_action_stop = 0; C.path_action_restart = 1;
  C.path_action_continue = 2; C.path_action_reverse = 3;
  C.font_small = 0; C.font_med = 1; C.font_big = 2; C.font_huge = 3;
  MM.FONT_SIZES = [8, 10, 16, 24];

  // -------------------------------------------------------------------
  // ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДВИЖКА
  // -------------------------------------------------------------------
  function roomVar() { return MM.state.room; }
  function selfBox(ctx) { return (ctx && ctx.self && MM.bbox) ? MM.bbox(ctx.self) : null; }
  V.bbox_left = { get: function (ctx) { var b = selfBox(ctx); return b ? b.l : 0; } };
  V.bbox_right = { get: function (ctx) { var b = selfBox(ctx); return b ? b.r : 0; } };
  V.bbox_top = { get: function (ctx) { var b = selfBox(ctx); return b ? b.t : 0; } };
  V.bbox_bottom = { get: function (ctx) { var b = selfBox(ctx); return b ? b.b : 0; } };
  V.room = { get: function () { return roomVar() || MM.NOONE; } };
  V.room_speed = { get: function () { return roomVar() ? roomVar().speed : 60; } };
  V.room_width = { get: function () { return roomVar() ? roomVar().w : MM.VIEW_W; } };
  V.room_height = { get: function () { return roomVar() ? roomVar().h : MM.VIEW_H; } };
  V.room_name = { get: function () { return roomVar() ? roomVar().name : ''; } };
  V.gui_width = { get: function () { return MM.VIEW_W; } };
  V.gui_height = { get: function () { return MM.VIEW_H; } };
  V.view_xview = { get: function () { return MM.view.xview; } };
  V.view_yview = { get: function () { return MM.view.yview; } };
  V.view_wview = { get: function () { return MM.view.wview; } };
  V.view_hview = { get: function () { return MM.view.hview; } };
  V.view_visible = { get: function () { return MM.view.visible; } };
  V.view_object = { get: function () { return MM.view.object; } };
  V.mouse_x = { get: function () { return MM.input.mouseX; } };
  V.mouse_y = { get: function () { return MM.input.mouseY; } };
  V.keyboard_lastkey = { get: function () { return MM.input.lastKey; } };
  V.frame_count = { get: function () { return MM.state.frame; } };
  V.room_frame = { get: function () { return MM.state.frameInRoom; } };
  V.game_paused = { get: function () { return MM.state.paused ? 1 : 0; } };

})();
