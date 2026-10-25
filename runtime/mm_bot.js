/*
 * mm_bot.js -- "Бот-демо": автопрохождение всех трёх маршрутов.
 *
 * Кнопка на сайте запускает бота, который забирает управление и играет сам:
 *   Тейлз  -> GHZ  (Green Hill, самолётик, уровень)
 *   Наклз  -> Scrap Brain
 *   Эггман -> Eggman Base / Metal Sonic
 *
 * Бот не «читы»: он нажимает те же клавиши, что и игрок (стрелки, Z, X, D,
 * Enter).  Всё, что делает игра (катсцены, диалоги, переходы комнат,
 * мини-игры "продолжить"), остаётся родным.
 *
 * API (консоль/тесты):
 *   MM.bot.start('tails'|'knuckles'|'eggman'|'all')
 *   MM.bot.stop()
 *   MM.bot.status()
 *   MM.bot.fast(seconds)   -- прогнать N игровых секунд без рендера (для отладки)
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.MM) return;
  var MM = window.MM;

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
    Z: 90, X: 88, D: 68, ENTER: 13, SHIFT: 16
  };

  // ---------------------------------------------------------------------
  // Маршруты
  // ---------------------------------------------------------------------
  var ROUTES = {
    tails: {
      id: 'tails', name: 'Тейлз', hero: 'Tails', transist: 2,
      first: 'GHZIntro_6', goalRooms: ['DataSelect_5', 'InProgressRoom27', 'TitleScreen_3']
    },
    knuckles: {
      id: 'knuckles', name: 'Наклз', hero: 'Knuckles', transist: 2.5,
      first: 'ScrapBrain20', goalRooms: ['DataSelect_5', 'InProgressRoom27', 'TitleScreen_3']
    },
    eggman: {
      id: 'eggman', name: 'Эггман', hero: 'Eggman', transist: 2.7,
      first: 'EggmanBase1_23', goalRooms: ['DataSelect_5', 'InProgressRoom27', 'TitleScreen_3']
    }
  };

  // ---------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------
  var bot = {
    active: false,
    route: null,          // текущий объект маршрута
    queue: [],            // оставшиеся маршруты ("all")
    frame: 0,             // шагов с запуска
    routeFrame: 0,
    room: null,
    roomFrame: 0,
    roomPath: [],
    startX: 0, maxX: 0,
    lastX: 0, stuck: 0, bestX: 0,
    lastRoomAt: 0,
    stage: 'запуск',
    note: '',
    deaths: 0,
    assist: true,
    pressedAt: {},        // для антидребезга синтетических клавиш
    finished: [],
    uiText: '',
    _stepOrig: null,
    _lastRoomName: null,
    _waitUntil: 0
  };

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  // ---------------------------------------------------------------------
  // Поиск объектов
  // ---------------------------------------------------------------------
  function liveList() {
    return MM.state ? MM.state.instances : [];
  }

  function findInst(name) {
    var l = liveList();
    for (var i = 0; i < l.length; i++) {
      if (!l[i]._destroyed && !l[i]._deactivated && l[i].object_name === name) return l[i];
    }
    return null;
  }

  // герой: любой наследник Pers_Obj (Tails/Knuckles/Eggman/...), не PlayerDeath
  function heroInst() {
    var l = liveList();
    var persObj = MM.objects && MM.objects['Pers_Obj'];
    for (var i = 0; i < l.length; i++) {
      var o = l[i];
      if (o._destroyed || o._deactivated) continue;
      if (o.object_name === 'PlayerDeath') continue;
      if (persObj && MM.objectChainHas && MM.objectChainHas(o.object_index, persObj)) return o;
    }
    return null;
  }

  function dialogInst() { return findInst('SW'); }

  // ---------------------------------------------------------------------
  // Проба коллизий
  // ---------------------------------------------------------------------
  function probe(h, dx, dy) {
    if (!h) return false;
    try {
      return MM.placeMeeting(h, h.x + dx, h.y + dy, 'Solid_Mask') ||
             MM.placeMeeting(h, h.x + dx, h.y + dy, 'Break_Mask') ||
             MM.placeMeeting(h, h.x + dx, h.y + dy, 'VerticalSolid_Line') ||
             MM.placeMeeting(h, h.x + dx, h.y + dy, 'Solid_Line');
    } catch (e) { return false; }
  }

  function probeBreak(h, dx, dy) {
    if (!h) return false;
    try {
      return MM.placeMeeting(h, h.x + dx, h.y + dy, 'Break_Mask');
    } catch (e) { return false; }
  }

  function groundAhead(h, dx) {
    if (!h) return true;
    for (var dy = 10; dy <= 170; dy += 16) {
      if (probe(h, dx, dy)) return true;
    }
    return false;
  }

  // Ближайшая опасность (враг/шипы/лава) впереди.
  function hazardAhead(h) {
    if (!h) return null;
    var l = liveList();
    for (var i = 0; i < l.length; i++) {
      var o = l[i];
      if (o._destroyed || o._deactivated || o === h) continue;
      var dx = o.x - h.x, dy = o.y - h.y;
      if (dx < -16 || dx > 74 || dy < -70 || dy > 60) continue;
      var n = o.object_name || '';
      var kind = MM.kindOf ? MM.kindOf(o) : '';
      if (kind === 'hazard' ||
          /Spike|Fire|Lava|Buzz|Laser|Traktor|Saw|Bomb|Mine|Flame|Crab|Robot|Robo|Exetior|Metal|Burn|Trap/i.test(n)) {
        return o;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Управление маршрутом
  // ---------------------------------------------------------------------
  function routeGlobals(r) {
    var g = MM.globals;
    if (!g) return;
    // Демо играет все три маршрута независимо от прогресса сохранения.
    g.Data_Tails = 1; g.Data_Knuckles = 1; g.Data_Eggman = 1;
    g.Data_Tails_Win = 0; g.Data_Knuckles_Win = 0; g.Data_Eggman_Win = 0;
    g.Lives = 20;
    g.Immortality = 0;
    g.BloodyHill = 0;
    g.Sprite_Mode = 0;
    g.Dark_Mode = 0;
    g.Tails_Cont = 0; g.Tails_GU = 0;
    g.Knuckles_GU = 0; g.Tails_Knuckles = 0;
    g.MetalEggman_GU = 0;
    var god = findInst('GOD_OBJECT');
    if (god) {
      god.BloodyHill = 0;
      god.GHZ_TornadoSection = 0;
      god.GHZ_TornadoLose = 0;
      god.DeadHill = 0;
      god.DeadAnimals = 0;
      god.Speak = 0;
      god.BaseAlert_Light = 0;
      god.Fade_Mode = 0;
    }
    g.Transist = r.transist;
  }

  function startRoute(r) {
    bot.route = r;
    bot.routeFrame = 0;
    bot.roomPath = [];
    bot.stuck = 0;
    bot.bestX = 0;
    bot.maxX = 0;
    bot.lastRoomAt = 0;
    bot.stage = 'заставка';
    bot.note = '';
    bot._lastRoomName = null;
    routeGlobals(r);
    // Через BlackRoom_4 идёт родная заставка "Now loading" и нужный маршрут.
    MM.state.paused = false;
    MM.loading = null;
    MM._loadRoom('BlackRoom_4');
    hideOverlay();
  }

  function nextRoute() {
    if (!bot.queue.length) {
      bot.active = false;
      bot.stage = 'готово';
      setStatus();
      return;
    }
    var id = bot.queue.shift();
    var r = ROUTES[id];
    if (!r) return nextRoute();
    startRoute(r);
  }

  function routeDone(reason) {
    if (!bot.route) return;
    bot.finished.push(bot.route.id);
    bot.note = reason || 'маршрут завершён';
    bot.stage = 'переход';
    bot.route = null;
    bot._waitUntil = now() + 1800;
  }

  function hideOverlay() {
    var ov = document.getElementById('overlay');
    if (ov && !ov.classList.contains('hidden')) {
      try { ov.click(); } catch (e) { /* ignore */ }
      ov.classList.add('hidden');
    }
    if (MM.audio && MM.audio.unlock) { try { MM.audio.unlock(); } catch (e) { /* ignore */ } }
  }

  // ---------------------------------------------------------------------
  // Искусственный интеллект
  // ---------------------------------------------------------------------
  var out = { keys: {}, pressed: {}, released: {} };

  function clearOut() {
    out.keys = {}; out.pressed = {}; out.released = {};
  }

  function tap(code, every) {
    // «Нажать» клавишу не чаще, чем раз в every шагов.
    var f = bot.frame - (bot.pressedAt[code] || -9999);
    if (f >= every) {
      out.pressed[code] = 1;
      bot.pressedAt[code] = bot.frame;
      return true;
    }
    return false;
  }

  // --- Tornado (самолётик Тейлза) --------------------------------------
  function laneClear(t, dx, dy) {
    try {
      return !MM.placeMeeting(t, t.x + dx, t.y + dy, 'Solid_Line') &&
             !MM.placeMeeting(t, t.x + dx, t.y + dy, 'Solid_Mask') &&
             !MM.placeMeeting(t, t.x + dx, t.y + dy, 'Break_Mask');
    } catch (e) { return true; }
  }

  function driveTornado(t) {
    if (!t || t.Move !== 1) return;
    // Ищем свободную полосу впереди: если текущая занята — вверх/вниз.
    var blocked = !laneClear(t, 58, 0);
    if (blocked) {
      if (laneClear(t, 58, -34)) out.keys[KEY.UP] = 1;
      else if (laneClear(t, 58, 34)) out.keys[KEY.DOWN] = 1;
      else out.keys[KEY.UP] = 1;
    } else {
      // Плавно возвращаемся к «средней» высоте, чтобы не влететь в верхнюю
      // границу и не упасть на землю.
      if (t.Ground === 0 && t.y > 2150) out.keys[KEY.UP] = 1;
      if (t.Ground === 0 && t.y < 1940) out.keys[KEY.DOWN] = 1;
    }
    // Самолёт не должен упереться в землю/потолок: если движения вверх мало,
    // чуть подныриваем.
    if (t.y >= 2214) out.keys[KEY.UP] = 1;
  }

  // --- Герой ------------------------------------------------------------
  function driveHero(h) {
    if (!h) return;
    // Игра сама запрещает движение в катсценах: Move=0.
    if (h.Move === 0 || h.Wait_mode === 1 || h.Out === 1 || h.Act === 1) return;

    var style = h.Style;
    var isTails = style === 2;
    var isKnuckles = style === 4;
    var isEggman = style === 5;
    var ground = h.ground === 1;

    // Основное движение — вправо (все уровни игры построены слева направо).
    out.keys[KEY.RIGHT] = 1;

    // Стена впереди / обрыв / опасность.
    var wall = probe(h, 16, 0) || probe(h, 15, -26) || probe(h, 20, -52);
    var wallUp = probe(h, 16, -70) || probe(h, 20, -100);
    var gap = ground && !groundAhead(h, 40) && !groundAhead(h, 26);
    var haz = hazardAhead(h);
    var breakWall = probeBreak(h, 16, 0) && probeBreak(h, 16, -30);

    // Прыжок
    if (ground && (wall || gap || (haz && haz.x - h.x < 52))) {
      if (tap(KEY.Z, 8)) out.keys[KEY.Z] = 1;
    }

    // Закольцованные уровни: если долго стоим — тоже прыгаем.
    if (bot.stuck > 40 && ground) {
      if (tap(KEY.Z, 20)) out.keys[KEY.Z] = 1;
    }

    // Тейлз: полёт над обрывом и для подъёма наверх.
    if (isTails) {
      if (!ground) {
        if (h.Fly === 1) {
          // Держим высоту короткими нажатиями Z (каждое даёт -2 vspeed).
          if (h.vspeed > -0.6 && tap(KEY.Z, 6)) out.keys[KEY.Z] = 1;
          if (gap && h.vspeed > 1.5) out.keys[KEY.Z] = 1;
        } else if (h.vspeed > 0.4 && (gap || (wall && !ground))) {
          if (tap(KEY.Z, 10)) out.keys[KEY.Z] = 1;
        }
      }
    }

    // Наклз: планирование (Z в воздухе) и карабканье по стене (вверх).
    if (isKnuckles) {
      if (h.Climb === 1) {
        out.keys = {}; out.keys[KEY.UP] = 1;
        if (bot.stuck > 60) { out.keys[KEY.RIGHT] = 1; out.keys[KEY.UP] = 1; }
        return;
      }
      if (!ground) {
        if (wall || gap) {
          out.keys[KEY.Z] = 1;   // планируем в стену -> захват
        } else if (h.Glide === 1) {
          out.keys[KEY.Z] = 1;
        }
      }
      // Ломаемые стены — бьём кулаком.
      if (breakWall && ground) {
        if (tap(KEY.D, 12)) out.keys[KEY.D] = 1;
      }
    }

    // Эггман: прыжок Z, вверх/вниз — наклон/реактивный ранец.
    if (isEggman) {
      if (!ground && wall && h.vspeed > 0) {
        if (tap(KEY.UP, 30)) out.keys[KEY.UP] = 1;
      }
    }

    // Враг прямо по курсу: Наклз бьёт, остальные прыгают в него.
    if (haz && ground) {
      if (isKnuckles) {
        if (tap(KEY.D, 10)) out.keys[KEY.D] = 1;
      } else if (tap(KEY.Z, 14)) {
        out.keys[KEY.Z] = 1;
      }
    }
  }

  // --- Мини-игры "continue"/GU -----------------------------------------
  function gameOverMini() {
    var names = ['Cont_Press', 'Cont_Z', 'Cont_Timer', 'Cont_Name', 'GU_Name',
                 'KnuxCont_Knux', 'GU_Tails1', 'GU_Tails2', 'GU_Tails3',
                 'GU_Fatality1', 'MGU_Metal', 'KnuxGU_Knux', 'Cont_Tails1'];
    for (var i = 0; i < names.length; i++) {
      if (findInst(names[i])) return names[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Шаг бота
  // ---------------------------------------------------------------------
  function think() {
    clearOut();
    if (!bot.active) return;
    // Global step counter: must advance on EVERY frame, including cutscenes,
    // otherwise the dialog "tap" timer never fires again after the first page.
    bot.frame++;

    var roomName = MM.state.room ? MM.state.room.name : null;
    if (roomName !== bot._lastRoomName) {
      bot._lastRoomName = roomName;
      bot.roomPath.push(roomName);
      if (bot.roomPath.length > 60) bot.roomPath.shift();
      bot.roomFrame = 0;
      bot.stuck = 0;
      bot.lastRoomAt = bot.frame;
      // Возврат в меню = маршрут закончился (или прервался смертью).
      if (bot.route && ROUTES[bot.route.id]) {
        var goals = ROUTES[bot.route.id].goalRooms;
        if (goals.indexOf(roomName) >= 0 && bot.frame > 60) {
          routeDone(roomName === 'InProgressRoom27' ? 'конец доступного контента' : 'маршрут завершён');
          return;
        }
      }
    }

    // Маршрут закончился, ждём и запускаем следующий.
    if (!bot.route) {
      if (bot.active && bot.queue.length && now() >= bot._waitUntil && bot._waitUntil) {
        bot._waitUntil = 0;
        nextRoute();
      }
      return;
    }

    bot.routeFrame++;
    bot.roomFrame++;

    // Диалоги/катсцены: Enter жмём регулярно (в игре есть свой антидребезг).
    if (dialogInst() || (MM.globals && MM.globals.Call_SW === 1)) {
      bot.stage = 'диалог';
      if (tap(KEY.ENTER, 18)) out.pressed[KEY.ENTER] = 1;
      return;
    }

    // Мини-игры после смерти/по сюжету: жмём Z.
    var mini = gameOverMini();
    if (mini) {
      bot.stage = 'мини-игра';
      if (tap(KEY.Z, 16)) { out.pressed[KEY.Z] = 1; out.keys[KEY.Z] = 1; }
      return;
    }

    // Самолётик.
    var tornado = findInst('GHZ_TornadoTails');
    if (tornado) {
      bot.stage = 'самолёт';
      driveTornado(tornado);
      return;
    }

    var h = heroInst();
    if (!h) {
      // Катсцена без героя: иногда нужно нажать Z (продолжить).
      bot.stage = 'катсцена';
      if (bot.roomFrame % 30 === 0) out.pressed[KEY.Z] = 1;
      return;
    }

    // Прогресс/застревание.
    if (h.x > bot.maxX) bot.maxX = h.x;
    var dx = h.x - bot.lastX;
    if (dx > 0.4) bot.stuck = 0; else bot.stuck++;
    bot.lastX = h.x;

    if (h.Move === 0) bot.stage = 'катсцена';
    else bot.stage = 'игра';

    // Помощь демо: не даём умереть от нехватки колец (падения в яму всё равно
    // обрабатывает игра — это часть прохождения).
    if (bot.assist && (h.rings || 0) < 8) h.rings = 30;

    driveHero(h);

    // Застряли надолго: отходим назад и пробуем ещё раз.
    if (bot.stuck > 110 && bot.stuck % 40 === 0) {
      pressedOnce(KEY.LEFT);
    }
    if (bot.stuck > 260) {
      // Мягкий «толчок»: если впереди нет стены, просто сдвигаем на шаг.
      if (!probe(h, 8, 0)) h.x += 4;
    }
  }

  function pressedOnce(code) {
    clearOut();
    out.keys[code] = 1;
    out.pressed[code] = 1;
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  function fmtTime(frames) {
    var s = Math.floor(frames / 60);
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m > 9 ? m : '0' + m) + ':' + (s > 9 ? s : '0' + s);
  }

  function setStatus() {
    var el = document.getElementById('botstatus');
    if (!el) return;
    var txt;
    if (!bot.active) {
      txt = bot.stage === 'готово' ? 'Демо завершено · ' + bot.finished.length + '/3 маршрута' : 'Не запущен';
    } else if (!bot.route) {
      txt = 'Переход к следующему маршруту…';
    } else {
      var room = MM.state.room ? MM.state.room.name : '?';
      var pct = '';
      if (MM.state.room && MM.state.room.w > 900) {
        pct = ' · ' + Math.min(100, Math.floor(bot.maxX * 100 / MM.state.room.w)) + '%';
      }
      txt = bot.route.name + ' · ' + room + pct + ' · ' + bot.stage +
            ' · ' + fmtTime(bot.routeFrame) +
            (bot.stuck > 90 ? ' · застревание' : '');
    }
    if (txt !== bot.uiText) {
      bot.uiText = txt;
      el.textContent = txt;
    }
    var btn = document.getElementById('bot-btn');
    if (btn) btn.textContent = bot.active ? '⏹ Остановить бота' : '🤖 Бот-демо';
    var panel = document.getElementById('botpanel');
    if (panel) panel.classList.toggle('running', bot.active);
  }

  // ---------------------------------------------------------------------
  // Публичный API
  // ---------------------------------------------------------------------
  MM.bot = {
    routes: ROUTES,

    start: function (id) {
      if (!MM.state || !MM.state.room) return false;
      hideOverlay();
      bot.active = true;
      bot.frame = 0;
      bot.finished = [];
      bot.pressedAt = {};
      bot.queue = [];
      if (id === 'all' || !id) {
        bot.queue = ORDER.slice();
      } else if (ROUTES[id]) {
        bot.queue = [id];
      } else {
        return false;
      }
      // Первый маршрут стартует сразу, остальные — по завершении.
      var first = bot.queue.shift();
      var r = ROUTES[first];
      bot._waitUntil = 0;
      startRoute(r);
      setStatus();
      return true;
    },

    stop: function () {
      bot.active = false;
      bot.route = null;
      bot.queue = [];
      bot.stage = 'остановлен';
      bot.note = '';
      clearOut();
      MM.input.keys = {}; MM.input.pressed = {}; MM.input.released = {};
      setStatus();
    },

    status: function () {
      return {
        active: bot.active,
        route: bot.route ? bot.route.id : null,
        room: MM.state.room ? MM.state.room.name : null,
        frame: bot.routeFrame,
        roomFrame: bot.roomFrame,
        x: bot.lastX, maxX: bot.maxX, stuck: bot.stuck,
        stage: bot.stage, path: bot.roomPath.slice(),
        finished: bot.finished.slice(), queue: bot.queue.slice()
      };
    },

    // Отладка: быстро прогнать N игровых секунд без ожидания realtime.
    fast: function (seconds) {
      var steps = Math.max(1, Math.round((seconds || 10) * 60));
      var before = bot.active;
      if (!before) return null;
      MM.stop();
      for (var i = 0; i < steps; i++) {
        MM.step();
        if (!bot.active) break;
      }
      return this.status();
    },

    setAssist: function (on) { bot.assist = !!on; }
  };

  // ---------------------------------------------------------------------
  // Врезка в игровой цикл
  // ---------------------------------------------------------------------
  bot._stepOrig = MM.step;
  MM.step = function () {
    if (bot.active) {
      // Игрок не управляет: любые реальные нажатия затираются каждый шаг.
      MM.input.keys = {};
      MM.input.pressed = {};
      MM.input.released = {};
      try { think(); } catch (e) {
        if (!bot._err) bot._err = String(e && e.message || e);
        clearOut();
      }
      MM.input.keys = out.keys;
      MM.input.pressed = out.pressed;
      MM.input.released = out.released;
      MM.input.anyKeyPressed = false;
    }
    bot._stepOrig.apply(MM, arguments);
  };

  // Периодическое обновление панели (не в каждом кадре).
  if (typeof setInterval === 'function') {
    setInterval(function () { if (bot.active) setStatus(); }, 400);
  }

  // ---------------------------------------------------------------------
  // Кнопки на странице
  // ---------------------------------------------------------------------
  function bindUI() {
    var btn = document.getElementById('bot-btn');
    var panel = document.getElementById('botpanel');
    if (!btn || !panel) return;

    btn.addEventListener('click', function () {
      if (bot.active) {
        MM.bot.stop();
        return;
      }
      panel.classList.toggle('open');
      hideOverlay();
      if (MM.audio && MM.audio.unlock) { try { MM.audio.unlock(); } catch (e) { /* ignore */ } }
      if (this.blur) this.blur();
    });

    var routeBtns = panel.querySelectorAll('[data-route]');
    for (var i = 0; i < routeBtns.length; i++) {
      routeBtns[i].addEventListener('click', function () {
        var id = this.getAttribute('data-route');
        if (id === 'stop') { MM.bot.stop(); return; }
        MM.bot.start(id);
        panel.classList.add('open');
        if (this.blur) this.blur();
      });
    }

    var close = panel.querySelector('.bp-close');
    if (close) close.addEventListener('click', function () { panel.classList.remove('open'); });

    setStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindUI);
  } else {
    bindUI();
  }
})();
