/* =====================================================================
 * mm_fanending.js -- unofficial fan endings for the browser port.
 *
 * The original "Sonic.exe: Nightmare Beginning Remake" contains two empty,
 * unreachable rooms, `Outro22` and `PervisionDIM_24`.  This module fills
 * them with a small scripted epilogue (two alternate fan endings) and keeps
 * a large, permanent non-affiliation / copyright notice on screen.
 *
 * Nothing in the original game data is modified: the module only listens to
 * the runtime hooks (onRoomLoaded / onStep / onDraw) and draws over the
 * empty black room.
 *
 * This is a NON-COMMERCIAL FAN PROJECT.  Sonic the Hedgehog and all related
 * characters are trademarks of SEGA.  "Sonic.exe" belongs to its respective
 * authors.  No affiliation, no endorsement, no monetisation.
 * ===================================================================== */
(function () {
  'use strict';
  var MM = window.MM;
  if (!MM) return;

  var RED = '#ff2b2b';
  var YELLOW = '#ffe27a';
  var WHITE = '#dcdce8';
  var DIM = '#7a7a90';

  var DISCLAIMER = [
    'НЕОФИЦИАЛЬНЫЙ ФАН-ПРОЕКТ · UNOFFICIAL FAN PROJECT',
    'НЕ СВЯЗАН С SEGA / ROBLOX / ПРАВООБЛАДАТЕЛЯМИ SONIC.EXE',
    'SONIC.EXE © ЕГО АВТОРЫ · БЕСПЛАТНО · НЕ ДЛЯ ПРОДАЖИ'
  ];

  var SCENES = {
    Outro22: {
      id: 1,
      glitch: 0,
      color: WHITE,
      beats: [
        { text: 'СТАТИКА СТИХАЕТ…', style: 'sys', pause: 90 },
        { text: 'Ты снова слышишь, как гудит старый монитор.', pause: 100 },
        { text: 'За окном — серое утро. Смех исчез.', pause: 100 },
        { text: 'Тейлз смотрит на свои руки. Они настоящие.', pause: 100 },
        { text: 'Он выжил. В этот раз.', pause: 120 },
        { text: 'ФАН-КОНЦОВКА 1 / 2', style: 'title', pause: 110 },
        { text: '«РАССВЕТ»', style: 'title2', pause: 140 },
        { text: 'Спасибо, что дошёл до конца.', style: 'dim', pause: 90 },
        { text: 'ENTER — в меню    ·    F2 — другая концовка', style: 'sys', pause: 0, last: true }
      ]
    },
    PervisionDIM_24: {
      id: 2,
      glitch: 1,
      color: '#ff9d9d',
      beats: [
        { text: 'ТЫ НЕ ДОЛЖЕН БЫЛ СЮДА ПОПАСТЬ.', style: 'sys', pause: 90 },
        { text: 'Здесь нет Тейлза.', pause: 100 },
        { text: 'Здесь нет тебя.', pause: 110 },
        { text: 'Есть только тот, кто смотрит из-за экрана.', pause: 120 },
        { text: 'Он уже в твоём компьютере.', pause: 130 },
        { text: 'ФАН-КОНЦОВКА 2 / 2', style: 'title', pause: 110 },
        { text: '«ИЗНАНКА»', style: 'title2', pause: 150 },
        { text: 'ENTER — в меню    ·    F1 — другая концовка', style: 'sys', pause: 0, last: true }
      ]
    }
  };

  var S = null;          // active cutscene state
  var clock = 0;         // global animation clock (used by the glitch)

  function isEndingRoom(name) { return !!SCENES[name]; }

  function startScene(roomName) {
    S = {
      room: roomName,
      scene: SCENES[roomName],
      beat: 0,
      shown: 0,
      wait: 0,
      done: false
    };
    clock = 0;
  }

  MM.onRoomLoaded = function (room) {
    S = null;
    if (room && isEndingRoom(room.name)) startScene(room.name);
  };

  function advance() {
    if (!S) return;
    var beat = S.scene.beats[S.beat];
    S.wait = 0;
    if (S.shown < beat.text.length) { S.shown = beat.text.length; return; }
    if (beat.last) { S.done = true; return; }
    S.beat++;
    S.shown = 0;
  }

  MM.onStep = function () {
    clock++;

    // Global shortcuts, available from anywhere in the game.
    if (MM.input && MM.input.pressed) {
      if (MM.input.pressed[112]) { MM.roomGoto('Outro22', true); return; }
      if (MM.input.pressed[113]) { MM.roomGoto('PervisionDIM_24', true); return; }
    }

    if (!S) return;

    var beat = S.scene.beats[S.beat];
    var px = MM.input && MM.input.pressed;
    var confirm = px && (px[13] || px[90] || px[32]);
    var back = px && px[27];

    if (back) { MM.roomGoto('TitleScreen_3', true); return; }
    if (S.done) {
      if (confirm) MM.roomGoto('TitleScreen_3', true);
      return;
    }
    if (confirm) { advance(); return; }

    if (S.shown < beat.text.length) {
      S.shown += 2;
      if (S.shown > beat.text.length) S.shown = beat.text.length;
    } else {
      S.wait++;
      if (beat.last) {
        if (S.wait > 45) S.done = true;
      } else if (S.wait > beat.pause) {
        advance();
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /*  drawing                                                            */
  /* ------------------------------------------------------------------ */

  function drawGlitch(ctx, W, H) {
    if (!S || !S.scene.glitch) return;
    // horizontal tear lines
    var n = 3 + (clock % 5);
    for (var i = 0; i < n; i++) {
      var y = (clock * 37 + i * 71) % H;
      var h = 1 + ((i * 13 + clock) % 3);
      ctx.globalAlpha = 0.10 + ((i * 17 + clock) % 100) / 500;
      ctx.fillStyle = i % 2 ? RED : '#2a0000';
      ctx.fillRect(0, y, W, h);
    }
    ctx.globalAlpha = 1;
    // rare red wash
    if (clock % 97 < 2) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = RED;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function drawDisclaimer(ctx, W, H) {
    var boxH = 86;
    var y0 = H - boxH;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, y0, W, boxH);
    ctx.fillStyle = 'rgba(255,43,43,0.65)';
    ctx.fillRect(0, y0, W, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd35c';
    ctx.font = 'bold 14px "Consolas", "Courier New", monospace';
    ctx.fillText(DISCLAIMER[0], W / 2, y0 + 20);
    ctx.fillStyle = '#ff5555';
    ctx.font = 'bold 17px "Consolas", "Courier New", monospace';
    ctx.fillText(DISCLAIMER[1], W / 2, y0 + 46);
    ctx.fillStyle = '#a9a9bd';
    ctx.font = '13px "Consolas", "Courier New", monospace';
    ctx.fillText(DISCLAIMER[2], W / 2, y0 + 70);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  function drawBeat(ctx, W, H, beat, shown, y, alpha) {
    var text = beat.text.slice(0, shown);
    ctx.globalAlpha = alpha;
    if (beat.style === 'title') {
      ctx.font = 'bold 26px "Consolas", "Courier New", monospace';
      ctx.fillStyle = YELLOW;
    } else if (beat.style === 'title2') {
      ctx.font = 'bold 34px "Consolas", "Courier New", monospace';
      ctx.fillStyle = S.scene.glitch ? RED : YELLOW;
    } else if (beat.style === 'sys') {
      ctx.font = 'bold 15px "Consolas", "Courier New", monospace';
      ctx.fillStyle = DIM;
    } else if (beat.style === 'dim') {
      ctx.font = '16px "Consolas", "Courier New", monospace';
      ctx.fillStyle = DIM;
    } else {
      ctx.font = 'bold 19px "Consolas", "Courier New", monospace';
      ctx.fillStyle = S.scene.color;
    }
    var x = W / 2;
    var jitter = 0;
    if (S.scene.glitch && Math.random() < 0.18) jitter = (Math.random() * 6 - 3) | 0;
    ctx.textAlign = 'center';
    ctx.fillText(text, x + jitter, y);
    // chromatic aberration on the horror scene
    if (S.scene.glitch && beat.style !== 'sys') {
      ctx.globalAlpha = alpha * 0.35;
      ctx.fillStyle = RED;
      ctx.fillText(text, x + jitter + 2, y);
      ctx.fillStyle = '#3d6bff';
      ctx.fillText(text, x + jitter - 2, y);
      ctx.fillStyle = S.scene.color;
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  MM.onDraw = function (ctx, W, H) {
    if (!S) return;

    // backdrop
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    var g = ctx.createLinearGradient(0, 0, 0, H);
    if (S.scene.glitch) {
      g.addColorStop(0, '#0a0000');
      g.addColorStop(1, '#1a0000');
    } else {
      g.addColorStop(0, '#080812');
      g.addColorStop(1, '#0d0d18');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawGlitch(ctx, W, H);

    var CY = H / 2 - 58;
    var beats = S.scene.beats;

    // previous beat, ghosted above
    if (S.beat > 0) {
      drawBeat(ctx, W, H, beats[S.beat - 1], beats[S.beat - 1].text.length, CY - 34, 0.28);
    }

    var beat = beats[S.beat];
    var y = CY;
    if (beat.style === 'title' || beat.style === 'title2') y = CY - 6;

    drawBeat(ctx, W, H, beat, S.shown, y, 1);

    // blinking caret while typing
    if (S.shown < beat.text.length) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = RED;
      ctx.fillRect(W / 2 - 1, y + 8, 2, 4);
      ctx.globalAlpha = 1;
    }

    // progress dots
    var n = beats.length;
    for (var i = 0; i < n; i++) {
      ctx.fillStyle = i <= S.beat ? (S.scene.glitch ? RED : YELLOW) : '#2a2a38';
      ctx.fillRect(W / 2 - (n * 8) / 2 + i * 8, H - 104, 4, 4);
    }

    drawDisclaimer(ctx, W, H);

    if (S.done) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "Consolas", "Courier New", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(clock / 22));
      ctx.fillText('ENTER — вернуться в меню', W / 2, H - 116);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
  };

  MM.fanEnding = {
    scenes: SCENES,
    isEndingRoom: isEndingRoom,
    goto: function (which) {
      MM.roomGoto(which === 2 ? 'PervisionDIM_24' : 'Outro22', true);
    }
  };
})();
