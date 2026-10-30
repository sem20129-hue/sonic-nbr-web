/* =====================================================================
 * mm_cheat.js -- local cheat / endings browser for the NBR web port
 *
 * The original game marks a route as "used" in global.Data_* as soon as it is
 * started, hides the endings behind one-shot save points, and has no scene
 * viewer.  This opt-in helper adds:
 *
 *   "Открыть все маршруты"  -> Data_* / *_Win = 0  (every route selectable)
 *   "Отметить всё пройденным" -> Data_* / *_Win = 1  (completed menu state)
 *   scene player            -> BlackRoom_4 with global.Transist = 1..25,
 *                              i.e. the BTO_* interludes/ending scenes
 *   quick room jumps        -> LastVoid16 / PostLastVoid_18 / Outro22 / GU_9
 *
 * Nothing happens unless the user presses a button; the chosen mode is kept in
 * localStorage and re-applied after a reload.
 * ===================================================================== */
(function () {
  'use strict';

  var MM = globalThis.MM || (globalThis.MM = {});

  var MODE_KEY = 'nbr.cheat.mode';           // '' | 'open' | 'done'
  var DATA_FLAGS = [
    'Data_Tails', 'Data_Knuckles', 'Data_Eggman', 'Data_Metal',
    'Data_Tails_Win', 'Data_Knuckles_Win', 'Data_Eggman_Win'
  ];
  var MENU_ROOM = 'LanguageSelect_19';
  var MENU_CREATE = 'gml_Room_LanguageSelect_19_Create';

  var mode = '';
  try { mode = localStorage.getItem(MODE_KEY) || ''; } catch (e) { mode = ''; }

  var TRANSITIONS = [
    [1, 'BTO_1'], [2, 'BTO_2'], [2.5, 'BTO_2_5'], [2.7, 'BTO_2_7'], [3, 'BTO_3'],
    [4, 'LN_HS2'], [5, 'BTO_4'], [6, 'BTO_5'], [7, 'BTO_6'], [8, 'BTO_7'],
    [9, 'BTO_8'], [10, 'BTO_9'], [11, 'BTO_10'], [12, 'BTO_11'], [13, 'BTO_12'],
    [14, 'BTO_13'], [15, 'BTO_14'], [16, 'BTO_15'], [17, 'BTO_16'], [18, 'BTO_17'],
    [19, 'BTO_18'], [20, 'BTO_19'], [21, 'BTO_20'], [22, 'BTO_21'], [23, 'BTO_22'],
    [24, 'BTO_23'], [25, 'BTO_24']
  ];
  var ROOM_JUMPS = [
    ['LastVoid16', 'Last Void'],
    ['PostLastVoid_18', 'Post Last Void'],
    ['Outro22', 'Outro'],
    ['GU_9', 'Continue / Game Over']
  ];

  function applyFlags(v) {
    var g = MM.globals;
    if (!g) return;
    for (var i = 0; i < DATA_FLAGS.length; i++) g[DATA_FLAGS[i]] = v;
    g.Cheat_Mode = v ? 1 : 0;
  }

  // The menu objects read global.Data_* in their Create events, so the room
  // create code must set the desired values before the instances are built.
  function patchMenu() {
    var b = MM.codeBundle;
    if (!b) return;
    var s = b[MENU_CREATE];
    if (typeof s !== 'string') return;
    if (!b[MENU_CREATE + '__orig']) b[MENU_CREATE + '__orig'] = s;
    var orig = b[MENU_CREATE + '__orig'];
    if (mode === 'done') {
      if (s.indexOf('// cheat: all done') < 0) {
        b[MENU_CREATE] = orig.replace(/global\.Data_(\w+) = 0;/g,
          'global.Data_$1 = 1; // cheat: all done');
      }
    } else if (s !== orig) {
      b[MENU_CREATE] = orig;                    // 'open' == original (zeros)
    }
  }

  function reloadMenuIfOpen() {
    if (!MM.state || !MM.state.room || MM.state.room.name !== MENU_ROOM) return;
    try { MM.roomGoto(MENU_ROOM, true); } catch (e) { /* ignore */ }
  }

  function setMode(next) {
    mode = (next === 'open' || next === 'done') ? next : '';
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* ignore */ }
    patchMenu();
    if (mode === 'done') applyFlags(1);
    else if (mode === 'open') applyFlags(0);
    reloadMenuIfOpen();
    updateUI();
  }

  function sceneName(n) {
    for (var i = 0; i < TRANSITIONS.length; i++) if (TRANSITIONS[i][0] === n) return TRANSITIONS[i][1];
    return '?';
  }

  function playTransition(n) {
    if (!MM.state) return;
    MM.globals.Transist = n;
    MM.state.paused = false;
    MM.state.pendingRoom = null;
    MM.loading = null;
    try { MM.roomGoto('BlackRoom_4', true); } catch (e) { /* ignore */ }
    setStatus('Интерлюдия ' + n + ' — ' + sceneName(n));
  }

  function gotoRoom(name) {
    if (!MM.state) return;
    MM.state.paused = false;
    MM.state.pendingRoom = null;
    MM.loading = null;
    try { MM.roomGoto(name, true); } catch (e) { /* ignore */ }
    setStatus('Комната ' + name);
  }

  // ---- boot hook --------------------------------------------------------
  // code.js is loaded after this file and nbrBoot() is called last, so the menu
  // patch has to be installed around that call.
  var origBoot = MM.nbrBoot;
  if (typeof origBoot === 'function') {
    MM.nbrBoot = function (opts) {
      var r = origBoot.apply(this, arguments);
      patchMenu();
      if (mode === 'done') applyFlags(1);
      else if (mode === 'open') applyFlags(0);
      if (mode) reloadMenuIfOpen();
      return r;
    };
  }

  // ---- UI ---------------------------------------------------------------
  var panel, btn, statusEl, openBtn, doneBtn, sceneSel;

  function setStatus(s) {
    if (statusEl) statusEl.textContent = s;
  }

  function updateUI() {
    if (openBtn) openBtn.classList.toggle('on', mode === 'open');
    if (doneBtn) doneBtn.classList.toggle('on', mode === 'done');
    if (sceneSel && !sceneSel.options.length) fillScenes();
  }

  function fillScenes() {
    if (!sceneSel) return;
    sceneSel.innerHTML = '';
    for (var i = 0; i < TRANSITIONS.length; i++) {
      var o = document.createElement('option');
      o.value = String(TRANSITIONS[i][0]);
      o.textContent = TRANSITIONS[i][0] + ' — ' + TRANSITIONS[i][1];
      sceneSel.appendChild(o);
    }
  }

  function buildUI() {
    btn = document.getElementById('cheat-btn');
    panel = document.getElementById('cheatpanel');
    if (!btn || !panel) return;
    statusEl = document.getElementById('cheatstatus');
    openBtn = document.getElementById('cheat-open');
    doneBtn = document.getElementById('cheat-done');
    sceneSel = document.getElementById('cheat-scene');

    btn.addEventListener('click', function () {
      panel.classList.toggle('open');
      updateUI();
      if (this.blur) this.blur();
    });
    var close = panel.querySelector('.cp-close');
    if (close) close.addEventListener('click', function () { panel.classList.remove('open'); });

    if (openBtn) openBtn.addEventListener('click', function () {
      setMode(mode === 'open' ? '' : 'open');
      setStatus(mode === 'open' ? 'Все маршруты доступны (блокировки сняты).' : 'Блокировки вернулись как в оригинале.');
      if (this.blur) this.blur();
    });
    if (doneBtn) doneBtn.addEventListener('click', function () {
      setMode(mode === 'done' ? '' : 'done');
      setStatus(mode === 'done' ? 'Все маршруты и концовки отмечены пройденными.' : 'Отметки сняты.');
      if (this.blur) this.blur();
    });

    fillScenes();
    var playBtn = document.getElementById('cheat-play');
    if (playBtn) playBtn.addEventListener('click', function () {
      if (!sceneSel) return;
      var n = Number(sceneSel.value);
      if (sceneSel.blur) sceneSel.blur();
      playTransition(n);
      if (this.blur) this.blur();
    });

    var roomsEl = document.getElementById('cheat-rooms');
    if (roomsEl) {
      for (var i = 0; i < ROOM_JUMPS.length; i++) {
        (function (name, label) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.addEventListener('click', function () { gotoRoom(name); if (this.blur) this.blur(); });
          roomsEl.appendChild(b);
        })(ROOM_JUMPS[i][0], ROOM_JUMPS[i][1]);
      }
    }

    updateUI();
  }

  MM.cheat = {
    get mode() { return mode; },
    setMode: setMode,
    openRoutes: function () { setMode('open'); },
    markAllDone: function () { setMode('done'); },
    reset: function () { setMode(''); },
    playTransition: playTransition,
    gotoRoom: gotoRoom,
    transitions: TRANSITIONS.slice()
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
  }
})();
