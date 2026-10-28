// =====================================================================
// MiniMaker — mm_interp.js
// Интерпретатор языка MM Script (подмножество GML в стиле Game Maker 8):
// лексер, рекурсивный парсер и обходчик AST. Компилирует код в кэш по строке.
// Публичный API: MM.interp.run(code, env), MM.interp.check(code, name),
// MM.interp.clearCache(), MM.interp.parse(code).
// =====================================================================
(function () {
  'use strict';

  var MM = (globalThis.MM = globalThis.MM || {});

  // ===================================================================
  // ЛЕКСЕР
  // ===================================================================
  var KEYWORDS = {
    'var': 1, 'globalvar': 1, 'if': 1, 'else': 1, 'while': 1, 'repeat': 1, 'for': 1,
    'with': 1, 'break': 1, 'continue': 1, 'return': 1, 'exit': 1, 'then': 1,
    'and': 1, 'or': 1, 'not': 1, 'xor': 1, 'div': 1, 'mod': 1,
    'self': 1, 'other': 1, 'all': 1, 'noone': 1, 'global': 1,
    'true': 1, 'false': 1, 'pi': 1
  };

  var PUNCT3 = ['<<=', '>>=', '<<', '>>', '&&=', '||='];
  var PUNCT2 = ['&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '++', '--', '|=', '&=', '^='];
  var PUNCT1 = '+-*/%<>=!&|^~(){}[],;.:?'.split('');

  function Lexer(src, name) {
    this.src = src;
    this.pos = 0;
    this.line = 1;
    this.name = name || '<code>';
    this.prev = null;
  }
  Lexer.prototype.error = function (msg) {
    throw new SyntaxError(this.name + ':' + this.line + ': ' + msg);
  };
  Lexer.prototype.tokenize = function () {
    var toks = [];
    var s = this.src;
    while (this.pos < s.length) {
      var c = s[this.pos];
      // пробелы и переводы строк
      if (c === '\n') { this.line++; this.pos++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { this.pos++; continue; }
      // комментарии
      if (c === '/' && s[this.pos + 1] === '/') {
        while (this.pos < s.length && s[this.pos] !== '\n') this.pos++;
        continue;
      }
      if (c === '/' && s[this.pos + 1] === '*') {
        this.pos += 2;
        while (this.pos < s.length && !(s[this.pos] === '*' && s[this.pos + 1] === '/')) {
          if (s[this.pos] === '\n') this.line++;
          this.pos++;
        }
        this.pos += 2;
        continue;
      }
      // число
      // GML colour literal: #rrggbb / #rgb -> stored internally as BGR
      if (c === '#') {
        var cstart = this.pos + 1;
        var cj = cstart;
        while (cj < s.length && /[0-9a-fA-F]/.test(s[cj])) cj++;
        var chex = s.slice(cstart, cj);
        if (chex.length === 6 || chex.length === 3) {
          this.pos = cj;
          if (chex.length === 3) chex = chex[0] + chex[0] + chex[1] + chex[1] + chex[2] + chex[2];
          var cr = parseInt(chex.substr(0, 2), 16);
          var cg = parseInt(chex.substr(2, 2), 16);
          var cb = parseInt(chex.substr(4, 2), 16);
          this.push(toks, { type: 'num', value: (cb << 16) | (cg << 8) | cr });
          continue;
        }
      }
      var isDigit = c >= '0' && c <= '9';
      var isDotNumber = c === '.' && s[this.pos + 1] >= '0' && s[this.pos + 1] <= '9' &&
        !(this.prev && (this.prev.type === 'num' || this.prev.type === 'id' || this.prev.value === ')' || this.prev.value === ']'));
      if (isDigit || isDotNumber) {
        var start = this.pos;
        var isHex = c === '0' && (s[this.pos + 1] === 'x' || s[this.pos + 1] === 'X');
        if (isHex) {
          this.pos += 2;
          while (this.pos < s.length && /[0-9a-fA-F]/.test(s[this.pos])) this.pos++;
          var hv = parseInt(s.slice(start + 2, this.pos), 16);
          this.push(toks, { type: 'num', value: hv });
          continue;
        }
        while (this.pos < s.length && /[0-9]/.test(s[this.pos])) this.pos++;
        if (s[this.pos] === '.') {
          this.pos++;
          while (this.pos < s.length && /[0-9]/.test(s[this.pos])) this.pos++;
        }
        this.push(toks, { type: 'num', value: parseFloat(s.slice(start, this.pos)) });
        continue;
      }
      // строка
      if (c === '"') {
        this.pos++;
        var str = '';
        while (this.pos < s.length && s[this.pos] !== '"') {
          var ch = s[this.pos];
          if (ch === '\\') {
            var nxt = s[this.pos + 1];
            if (nxt === 'n') str += '\n';
            else if (nxt === 't') str += '\t';
            else if (nxt === '"') str += '"';
            else if (nxt === '\\') str += '\\';
            else str += nxt;
            this.pos += 2;
            continue;
          }
          if (ch === '\n') this.line++;
          str += ch;
          this.pos++;
        }
        this.pos++;
        this.push(toks, { type: 'str', value: str });
        continue;
      }
      // идентификатор
      if (/[A-Za-z_]/.test(c)) {
        var st = this.pos;
        while (this.pos < s.length && /[A-Za-z0-9_]/.test(s[this.pos])) this.pos++;
        var word = s.slice(st, this.pos);
        this.push(toks, KEYWORDS[word] ? { type: 'kw', value: word } : { type: 'id', value: word });
        continue;
      }
      // пунктуация
      var three = s.substr(this.pos, 3);
      if (PUNCT3.indexOf(three) >= 0) { this.pos += 3; this.push(toks, { type: 'punc', value: three }); continue; }
      var two = s.substr(this.pos, 2);
      if (PUNCT2.indexOf(two) >= 0) { this.pos += 2; this.push(toks, { type: 'punc', value: two }); continue; }
      if (PUNCT1.indexOf(c) >= 0) { this.pos += 1; this.push(toks, { type: 'punc', value: c }); continue; }
      this.error('неизвестный символ "' + c + '"');
    }
    toks.push({ type: 'eof', value: null });
    return toks;
  };
  Lexer.prototype.push = function (toks, tok) {
    tok.line = this.line;
    toks.push(tok);
    this.prev = tok;
  };

  // ===================================================================
  // ПАРСЕР
  // ===================================================================
  function Parser(toks, name) {
    this.toks = toks;
    this.i = 0;
    this.name = name || '<code>';
  }
  Parser.prototype.peek = function () { return this.toks[this.i]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.error = function (msg) {
    var t = this.peek();
    throw new SyntaxError(this.name + ':' + (t.line || '?') + ': ' + msg + ' (токен: ' + JSON.stringify(t.value) + ')');
  };
  Parser.prototype.isPunc = function (v) { var t = this.peek(); return t.type === 'punc' && t.value === v; };
  Parser.prototype.isKw = function (v) { var t = this.peek(); return t.type === 'kw' && t.value === v; };
  Parser.prototype.acceptPunc = function (v) { if (this.isPunc(v)) { this.next(); return true; } return false; };
  Parser.prototype.acceptKw = function (v) { if (this.isKw(v)) { this.next(); return true; } return false; };
  Parser.prototype.expectPunc = function (v) { if (!this.acceptPunc(v)) this.error('ожидалось "' + v + '"'); };
  Parser.prototype.expectId = function () {
    var t = this.peek();
    if (t.type !== 'id' && t.type !== 'kw') this.error('ожидалось имя');
    this.next();
    return t.value;
  };

  Parser.prototype.parseProgram = function () {
    var body = [];
    while (this.peek().type !== 'eof') {
      body.push(this.parseStatement());
    }
    return { type: 'block', body: body };
  };

  Parser.prototype.parseBlock = function () {
    this.expectPunc('{');
    var body = [];
    while (!this.isPunc('}') && this.peek().type !== 'eof') {
      body.push(this.parseStatement());
    }
    this.expectPunc('}');
    return { type: 'block', body: body };
  };

  Parser.prototype.parseStatement = function () {
    var t = this.peek();
    if (t.type === 'punc' && t.value === '{') return this.parseBlock();
    if (t.type === 'punc' && t.value === ';') { this.next(); return { type: 'empty' }; }
    if (t.type === 'kw') {
      switch (t.value) {
        case 'var': {
          this.next();
          var list = [];
          for (;;) {
            var nm = this.expectId();
            var init = null;
            if (this.acceptPunc('=')) init = this.parseExpr();
            list.push({ name: nm, init: init });
            if (!this.acceptPunc(',')) break;
          }
          this.acceptPunc(';');
          return { type: 'vardecl', names: list };
        }
        case 'globalvar': {
          this.next();
          var names = [];
          for (;;) {
            names.push(this.expectId());
            if (!this.acceptPunc(',')) break;
          }
          this.acceptPunc(';');
          return { type: 'globalvar', names: names };
        }
        case 'if': {
          this.next();
          var cond = this.parseExpr();
          this.acceptKw('then');
          var th = this.parseStatement();
          var el = null;
          if (this.acceptKw('else')) el = this.parseStatement();
          return { type: 'if', cond: cond, then: th, else: el };
        }
        case 'while': {
          this.next();
          var c2 = this.parseExpr();
          var b2 = this.parseStatement();
          return { type: 'while', cond: c2, body: b2 };
        }
        case 'repeat': {
          this.next();
          var n = this.parseExpr();
          var b3 = this.parseStatement();
          return { type: 'repeat', count: n, body: b3 };
        }
        case 'for': {
          this.next();
          this.expectPunc('(');
          var init = null, cond = null, post = null;
          if (!this.isPunc(';')) {
            if (this.isKw('var')) init = this.parseStatementNoSemicolon();
            else { init = { type: 'expr', expr: this.parseExpr() }; }
          }
          this.expectPunc(';');
          if (!this.isPunc(';')) cond = this.parseExpr();
          this.expectPunc(';');
          if (!this.isPunc(')')) post = this.parseExpr();
          this.expectPunc(')');
          var body = this.parseStatement();
          return { type: 'for', init: init, cond: cond, post: post, body: body };
        }
        case 'with': {
          this.next();
          var target = this.parseExpr();
          var wb = this.parseStatement();
          return { type: 'with', target: target, body: wb };
        }
        case 'break': this.next(); this.acceptPunc(';'); return { type: 'break' };
        case 'continue': this.next(); this.acceptPunc(';'); return { type: 'continue' };
        case 'exit': this.next(); this.acceptPunc(';'); return { type: 'exit' };
        case 'return': {
          this.next();
          var v = null;
          if (!this.isPunc(';') && !this.isPunc('}') && this.peek().type !== 'eof') v = this.parseExpr();
          this.acceptPunc(';');
          return { type: 'return', value: v };
        }
      }
    }
    var expr = this.parseExpr();
    this.acceptPunc(';');
    return { type: 'expr', expr: expr };
  };

  // var-объявление внутри for(...)
  Parser.prototype.parseStatementNoSemicolon = function () {
    var st = this.parseStatement();
    return st;
  };

  var ASSIGN_OPS = { '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1, '|=': 1, '&=': 1, '^=': 1 };
  var BIN_LEVELS = [
    ['||', 'or'],
    ['&&', 'and'],
    ['==', '!=', '<', '<=', '>', '>='],
    ['|'],
    ['^', 'xor'],
    ['&'],
    ['<<', '>>'],
    ['+', '-'],
    ['*', '/', 'div', 'mod', '%']
  ];

  Parser.prototype.parseExpr = function () { return this.parseAssignment(); };

  Parser.prototype.parseAssignment = function () {
    var left = this.parseBinary(0);
    var t = this.peek();
    if (t.type === 'punc' && ASSIGN_OPS[t.value]) {
      if (left.type !== 'id' && left.type !== 'member' && left.type !== 'index') {
        this.error('нельзя присвоить в это выражение');
      }
      this.next();
      var value = this.parseAssignment();
      return { type: 'assign', op: t.value, target: left, value: value };
    }
    return left;
  };

  Parser.prototype.parseBinary = function (level) {
    if (level >= BIN_LEVELS.length) return this.parseUnary();
    var ops = BIN_LEVELS[level];
    var left = this.parseBinary(level + 1);
    for (;;) {
      var t = this.peek();
      var op = null;
      if (t.type === 'punc' && ops.indexOf(t.value) >= 0) op = t.value;
      else if (t.type === 'kw' && ops.indexOf(t.value) >= 0) op = t.value;
      if (!op) break;
      this.next();
      var right = this.parseBinary(level + 1);
      left = { type: 'bin', op: op, l: left, r: right };
    }
    return left;
  };

  Parser.prototype.parseUnary = function () {
    var t = this.peek();
    if (t.type === 'punc' && (t.value === '-' || t.value === '!' || t.value === '~' || t.value === '++' || t.value === '--')) {
      this.next();
      var e = this.parseUnary();
      return { type: 'un', op: t.value, e: e };
    }
    if (t.type === 'kw' && t.value === 'not') {
      this.next();
      return { type: 'un', op: '!', e: this.parseUnary() };
    }
    return this.parsePostfix();
  };

  Parser.prototype.parsePostfix = function () {
    var e = this.parsePrimary();
    for (;;) {
      if (this.isPunc('(')) {
        this.next();
        var args = [];
        if (!this.isPunc(')')) {
          for (;;) {
            args.push(this.parseExpr());
            if (!this.acceptPunc(',')) break;
          }
        }
        this.expectPunc(')');
        e = { type: 'call', callee: e, args: args };
        continue;
      }
      if (this.isPunc('[')) {
        this.next();
        var indices = [];
        for (;;) {
          indices.push(this.parseExpr());
          if (!this.acceptPunc(',')) break;
        }
        this.expectPunc(']');
        e = { type: 'index', obj: e, indices: indices };
        continue;
      }
      if (this.isPunc('.')) {
        this.next();
        var nm = this.expectId();
        e = { type: 'member', obj: e, name: nm };
        continue;
      }
      if (this.isPunc('++') || this.isPunc('--')) {
        var op = this.next().value;
        e = { type: 'postfix', op: op, target: e };
        continue;
      }
      break;
    }
    return e;
  };

  Parser.prototype.parsePrimary = function () {
    var t = this.next();
    if (t.type === 'num') return { type: 'num', v: t.value };
    if (t.type === 'str') return { type: 'str', v: t.value };
    if (t.type === 'id') return { type: 'id', name: t.value };
    if (t.type === 'kw') {
      switch (t.value) {
        case 'self': return { type: 'id', name: 'self' };
        case 'other': return { type: 'id', name: 'other' };
        case 'all': return { type: 'id', name: 'all' };
        case 'noone': return { type: 'id', name: 'noone' };
        case 'global': return { type: 'id', name: 'global' };
        case 'true': return { type: 'num', v: 1 };
        case 'false': return { type: 'num', v: 0 };
        case 'pi': return { type: 'num', v: Math.PI };
        case 'not': return { type: 'un', op: '!', e: this.parseUnary() };
      }
      this.error('неожиданное ключевое слово "' + t.value + '"');
    }
    if (t.type === 'punc' && t.value === '(') {
      var e = this.parseExpr();
      this.expectPunc(')');
      return e;
    }
    this.error('неожиданный токен ' + JSON.stringify(t.value));
  };

  // ===================================================================
  // СИГНАЛЫ УПРАВЛЕНИЯ
  // ===================================================================
  function BreakSignal() {}
  function ContinueSignal() {}
  function ExitSignal() {}
  function ReturnSignal(v) { this.value = v; }
  var BREAK = new BreakSignal();
  var CONTINUE = new ContinueSignal();
  var EXIT = new ExitSignal();

  // ===================================================================
  // ИНТЕРПРЕТАТОР
  // ===================================================================
  var cache = new Map();
  var globalNames = Object.create(null);
  var warnedNames = Object.create(null);

  function truthy(v) { return !(v === 0 || v === false || v === null || v === undefined || v === ''); }

  function Scope(parent) {
    this.vars = Object.create(null);
    this.parent = parent || null;
    this.count = 0;
  }
  Scope.prototype.has = function (name) {
    var s = this;
    while (s) {
      if (name in s.vars) return true;
      s = s.parent;
    }
    return false;
  };
  Scope.prototype.get = function (name) {
    var s = this;
    while (s) {
      if (name in s.vars) return s.vars[name];
      s = s.parent;
    }
    return undefined;
  };
  // Single-walk lookup: returns NOT_FOUND (a unique sentinel) when the name
  // is not a local variable in any scope.
  var NOT_FOUND = { notFound: true };
  Scope.prototype.read = function (name) {
    var s = this;
    while (s) {
      var vars = s.vars;
      var v = vars[name];
      if (v !== undefined || (name in vars)) return v;
      s = s.parent;
    }
    return NOT_FOUND;
  };
  // Assign only if the variable already exists in the chain (walk once).
  Scope.prototype.setExisting = function (name, v) {
    var s = this;
    while (s) {
      if (name in s.vars) { s.vars[name] = v; return true; }
      s = s.parent;
    }
    return false;
  };

  Scope.prototype.set = function (name, v) {
    var s = this;
    while (s) {
      if (name in s.vars) { s.vars[name] = v; return; }
      s = s.parent;
    }
    this.vars[name] = v;
    this.count++;
  };

  function isInstance(v) {
    return v instanceof MM.Instance;
  }

  function warnName(name, ctx) {
    var key = name + '|' + (ctx && ctx.name);
    if (warnedNames[key]) return;
    warnedNames[key] = true;
    MM.warn('Неизвестная переменная "' + name + '" в ' + (ctx && ctx.name || '?'));
  }

  // GML: имя объекта в выражении -- это id одного из его инстансов.
  // The instance may also belong to a CHILD object: `Pers_Obj.x` must resolve
  // to the live Knuckles/Tails/Sonic instance, otherwise every badnik, ground
  // and camera script reads 0 instead of the player state (that is what made
  // Knuckles unable to hurt badniks, glide or keep moving).
  var _itCache = Object.create(null);
  var _itVersion = -1;

  function instTarget(v) {
    if (!v || typeof v !== 'object' || !v.__objDef || !MM.state) return v;
    var ver = MM.state.version;
    if (_itVersion !== ver) { _itCache = Object.create(null); _itVersion = ver; }
    var key = v.name || '';
    var hit = _itCache[key];
    if (hit !== undefined) return hit || v;
    var list = MM.state.instances;
    var child = null;
    var idSet = MM.objectIdSet ? MM.objectIdSet(v) : null;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o._destroyed || o._deactivated) continue;
      if (o.object_index === v) { _itCache[key] = o; return o; }
      if (!child) {
        if (idSet) { if (idSet.has(o.object_index)) child = o; }
        else if (MM.objectChainHas && MM.objectChainHas(o.object_index, v)) child = o;
      }
    }
    if (child) { _itCache[key] = child; return child; }
    _itCache[key] = null;
    return v;
  }

  function setMemberValue(obj, name, value) {
    if (!obj || typeof obj !== 'object') return;
    if (name === 'speed') { MM.motionSetSpeed(obj, value); return; }
    if (name === 'direction') { MM.motionSetDirection(obj, value); return; }
    if ((name === 'sprite_index' || name === 'mask_index') && typeof value === 'number') {
      value = MM.resolveSprite(value); // GML may store a raw resource id
    }
    obj[name] = value;
  }

  function identValue(name, ctx) {
    switch (name) {
      case 'self': return ctx.self;
      case 'other': return ctx.other;
      case 'global': return MM.globals;
      case 'all': return MM.ALL;
      case 'noone': return MM.NOONE;
    }
    if (ctx.scope) {
      // Inline the scope walk: this runs for almost every identifier in every
      // event, and the extra method call was one of the hottest functions.
      var sc = ctx.scope;
      var sv = sc.vars[name];
      if (sv !== undefined || (name in sc.vars)) return sv;
      var sp = sc.parent;
      while (sp) {
        sv = sp.vars[name];
        if (sv !== undefined || (name in sp.vars)) return sv;
        sp = sp.parent;
      }
    }
    // bbox_* is read constantly by ground / wall probes; going through the
    // builtin getter table costs a dispatch per read.
    if (name.charCodeAt(0) === 98 && name.length > 6) {
      var bs = ctx.self;
      if (bs && (name === 'bbox_left' || name === 'bbox_right' ||
                 name === 'bbox_top' || name === 'bbox_bottom')) {
        var bb = MM.bbox(bs);
        if (!bb) return 0;
        if (name === 'bbox_left') return bb.l;
        if (name === 'bbox_right') return bb.r;
        if (name === 'bbox_top') return bb.t;
        return bb.b;
      }
    }
    if (MM.interp.globalNames[name]) {
      var gv = MM.globals[name];
      return gv === undefined ? 0 : gv;
    }
    var self = ctx.self;
    if (self) {
      // speed/direction are live views over hspeed/vspeed in GameMaker.
      if (name === 'speed') return MM.motionSpeed(self);
      if (name === 'direction') return MM.motionDirection(self);
      var v = self[name];
      if (v !== undefined) return v;
      if (name in self) return 0;
    }
    if (MM.builtinVars && MM.builtinVars[name]) return MM.builtinVars[name].get(ctx);
    if (MM.constants && (name in MM.constants)) return MM.constants[name];
    if (MM.builtins && MM.builtins[name]) return MM.builtins[name];
    if (MM.scripts && MM.scripts[name]) return makeScriptRef(name);
    // ресурсы: объекты, спрайты, комнаты, звуки, музыка
    if (MM.objects[name]) return MM.objects[name];
    if (MM.sprites[name]) return MM.sprites[name];
    if (MM.rooms[name]) return MM.rooms[name];
    if (MM.sounds[name]) return MM.sounds[name];
    if (MM.musics[name]) return MM.musics[name];
    if (MM.fonts && MM.fonts[name]) return MM.fonts[name];
    if (MM.bgImages && MM.bgImages[name]) return MM.bgImages[name];
    if (MM.paths && MM.paths[name]) return MM.paths[name];
    if (name in MM.globals) {
      var gv2 = MM.globals[name];
      return gv2 === undefined ? 0 : gv2;
    }
    warnName(name, ctx);
    return 0;
  }

  // ссылка на пользовательский скрипт как на функцию
  function makeScriptRef(name) {
    var fn = function (ctx, args) { return runScript(name, ctx, args); };
    fn.mmScript = name;
    return fn;
  }

  function runScript(name, callerCtx, args) {
    var code = MM.scripts[name];
    if (code == null) return 0;
    var entry = compile(code, 'script:' + name);
    if (entry.error) { MM.warn('Скрипт ' + name + ': ' + entry.error); return 0; }
    var scope = new Scope(null);
    scope.vars['argument_count'] = args ? args.length : 0;
    for (var i = 0; i < (args ? args.length : 0); i++) scope.vars['argument' + i] = args[i];
    var ctx = {
      self: callerCtx.self,
      other: callerCtx.other,
      scope: scope,
      name: 'script:' + name,
      ops: callerCtx.ops
    };
    try {
      execNode(entry.ast, ctx);
    } catch (sig) {
      if (sig instanceof ReturnSignal) return sig.value === undefined ? 0 : sig.value;
      if (sig instanceof ExitSignal) return 0;
      throw sig;
    }
    return 0;
  }

  function evalCall(node, ctx) {
    var callee = node.callee;
    var args = null;
    var i;
    if (callee.type === 'id') {
      var name = callee.name;
      // Resolve builtins/scripts once per call site; only an actual local
      // variable can shadow them (the scope counter tells us when to look).
      var direct = callee._direct;
      if (direct === undefined) {
        if (MM.builtins && MM.builtins[name]) direct = { b: MM.builtins[name] };
        else if (MM.scripts[name] != null) direct = { s: name };
        else direct = null;
        callee._direct = direct;
      }
      if (direct && !(ctx.scope && ctx.scope.count > 0 && ctx.scope.has(name))) {
        args = [];
        for (i = 0; i < node.args.length; i++) args.push(evalExpr(node.args[i], ctx));
        return direct.b ? direct.b(ctx, args) : runScript(name, ctx, args);
      }
      // локальные/переменные, если там функция
      if (ctx.scope && ctx.scope.has(name)) {
        var v = ctx.scope.get(name);
        if (typeof v === 'function') return callValue(v, node.args, ctx);
      }
      var selfVal = ctx.self && typeof ctx.self === 'object' && name in ctx.self ? ctx.self[name] : undefined;
      if (typeof selfVal === 'function') return callValue(selfVal, node.args, ctx);
      if (MM.interp.globalNames[name]) {
        var gv = MM.globals[name];
        if (typeof gv === 'function') return callValue(gv, node.args, ctx);
      }
      if (MM.scripts[name] != null) {
        args = [];
        for (i = 0; i < node.args.length; i++) args.push(evalExpr(node.args[i], ctx));
        return runScript(name, ctx, args);
      }
      if (MM.builtins && MM.builtins[name]) {
        args = [];
        for (i = 0; i < node.args.length; i++) args.push(evalExpr(node.args[i], ctx));
        return MM.builtins[name](ctx, args);
      }
      // может быть переменная с функцией из builtinVars
      var bv = identValue(name, ctx);
      if (typeof bv === 'function') return callValue(bv, node.args, ctx);
      warnName(name + '()', ctx);
      return 0;
    }
    var fn = evalExpr(callee, ctx);
    if (typeof fn === 'function') return callValue(fn, node.args, ctx);
    MM.warn('Попытка вызова не-функции: ' + (ctx.name || '?'));
    return 0;
  }

  function callValue(fn, argNodes, ctx) {
    var args = [];
    for (var i = 0; i < argNodes.length; i++) args.push(evalExpr(argNodes[i], ctx));
    return fn(ctx, args);
  }

  // --- lvalue --------------------------------------------------------
  function lvalueGet(node, ctx) {
    if (node.type === 'id') return identValue(node.name, ctx);
    if (node.type === 'member') {
      var obj = instTarget(evalExpr(node.obj, ctx));
      if (obj && typeof obj === 'object') return memberGet(obj, node.name);
      return 0;
    }
    if (node.type === 'index') {
      var base = instTarget(evalExpr(node.obj, ctx));
      var idx = evalExpr(node.indices[0], ctx);
      if (node.indices.length === 1) {
        if (base == null) return 0;
        var r = base[idx];
        return r === undefined ? 0 : r;
      }
      if (base == null) return 0;
      var sub = base[idx];
      if (sub == null) return 0;
      var r2 = sub[evalExpr(node.indices[1], ctx)];
      return r2 === undefined ? 0 : r2;
    }
    return evalExpr(node, ctx);
  }

  function identKnown(name, ctx) {
    if (ctx.scope && ctx.scope.has(name)) return true;
    if (MM.interp.globalNames[name]) return true;
    if (ctx.self && typeof ctx.self === 'object' && name in ctx.self) return true;
    if (MM.builtinVars && MM.builtinVars[name]) return true;
    if (MM.constants && (name in MM.constants)) return true;
    if (MM.fonts && MM.fonts[name]) return true;
    if (MM.bgImages && MM.bgImages[name]) return true;
    if (MM.paths && MM.paths[name]) return true;
    if (name in MM.globals) return true;
    return false;
  }

  function lvalueSet(node, ctx, value) {
    if (node.type === 'id') {
      var name = node.name;
      if (name === 'self' || name === 'other' || name === 'global') { MM.warn('нельзя присвоить ' + name); return; }
      if (ctx.scope && ctx.scope.setExisting(name, value)) return;
      if (MM.interp.globalNames[name]) { MM.globals[name] = value; return; }
      if (ctx.self && typeof ctx.self === 'object') {
        if (name === 'speed') { MM.motionSetSpeed(ctx.self, value); return; }
        if (name === 'direction') { MM.motionSetDirection(ctx.self, value); return; }
        ctx.self[name] = value; return;
      }
      MM.warn('нет self для присвоения "' + name + '"');
      return;
    }
    if (node.type === 'member') {
      var rawTarget = evalExpr(node.obj, ctx);
      // GameMaker semantics: `Object.variable = value` writes the variable to
      // EVERY live instance of that object (a read still uses the first one).
      // Touching only the first instance silently dropped lines such as
      // `MYCR_TailsClone.Mode = 0`, so the cut-scene clones stayed invisible,
      // and `YCR_Ground.sprite_index = ...` (blood on a single tile).
      if (rawTarget && typeof rawTarget === 'object' && rawTarget.__objDef) {
        if (!MM.state) return;
        var idSet = MM.objectIdSet ? MM.objectIdSet(rawTarget) : null;
        var mlist = MM.state.instances;
        for (var mi = 0; mi < mlist.length; mi++) {
          var mo = mlist[mi];
          if (mo._destroyed || mo._deactivated) continue;
          if (idSet) {
            if (!idSet.has(mo.object_index)) continue;
          } else if (mo.object_index !== rawTarget &&
                     !(MM.objectChainHas && MM.objectChainHas(mo.object_index, rawTarget))) continue;
          setMemberValue(mo, node.name, value);
        }
        return;
      }
      var obj = instTarget(rawTarget);
      if (obj && typeof obj === 'object') {
        setMemberValue(obj, node.name, value);
        return;
      }
      MM.warn('присвоение свойства у не-объекта: ' + node.name);
      return;
    }
    if (node.type === 'index') {
      var base;
      if (node.obj.type === 'id' && !identKnown(node.obj.name, ctx)) {
        // авто-создание массива: arr[0] = ... для неизвестного arr
        base = [];
        lvalueSet(node.obj, ctx, base);
      } else {
        base = instTarget(evalExpr(node.obj, ctx));
        if (base == null || (typeof base !== 'object' && typeof base !== 'function')) {
          MM.warn('индекс у не-массива');
          return;
        }
      }
      var idx = evalExpr(node.indices[0], ctx);
      if (node.indices.length === 1) { base[idx] = value; return; }
      if (base[idx] == null) base[idx] = [];
      base[idx][evalExpr(node.indices[1], ctx)] = value;
      return;
    }
    MM.warn('некорректная цель присвоения');
  }

  // --- числовые операции ---------------------------------------------
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var n = Number(v); return isNaN(n) ? 0 : n; }
    if (v === true) return 1;
    if (v === false || v == null) return 0;
    return 0;
  }

  function binOp(op, a, b) {
    switch (op) {
      case '+':
        if (typeof a === 'string' || typeof b === 'string') {
          return (typeof a === 'string' ? a : simplifyStr(a)) + (typeof b === 'string' ? b : simplifyStr(b));
        }
        return toNum(a) + toNum(b);
      case '-': return toNum(a) - toNum(b);
      case '*': return toNum(a) * toNum(b);
      case '/': {
        var d = toNum(b);
        if (d === 0) { MM.warn('деление на ноль'); return 0; }
        return toNum(a) / d;
      }
      case 'div': {
        var d2 = toNum(b);
        if (d2 === 0) { MM.warn('деление на ноль (div)'); return 0; }
        return Math.trunc(toNum(a) / d2);
      }
      case 'mod': case '%': {
        var d3 = toNum(b);
        if (d3 === 0) { MM.warn('деление на ноль (mod)'); return 0; }
        return toNum(a) % d3;
      }
      case '|': return (toNum(a) | toNum(b));
      case '&': return (toNum(a) & toNum(b));
      case '^': case 'xor': return (toNum(a) ^ toNum(b));
      case '<<': return (toNum(a) << toNum(b));
      case '>>': return (toNum(a) >> toNum(b));
      case '==': return eq(a, b) ? 1 : 0;
      case '!=': return eq(a, b) ? 0 : 1;
      case '<': return numCmp(a, b) < 0 ? 1 : 0;
      case '<=': return numCmp(a, b) <= 0 ? 1 : 0;
      case '>': return numCmp(a, b) > 0 ? 1 : 0;
      case '>=': return numCmp(a, b) >= 0 ? 1 : 0;
      case '&&': case 'and': return (truthy(a) && truthy(b)) ? 1 : 0;
      case '||': case 'or': return (truthy(a) || truthy(b)) ? 1 : 0;
    }
    MM.warn('неизвестный оператор ' + op);
    return 0;
  }

  function simplifyStr(v) {
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return String(v);
      return String(parseFloat(v.toFixed(6)));
    }
    if (v === true) return '1';
    if (v === false) return '0';
    if (v == null) return '0';
    if (typeof v === 'object') {
      if (isInstance(v)) return '<instance ' + v.id + ' ' + v.object_name + '>';
      return '<object>';
    }
    return String(v);
  }

  function eq(a, b) {
    if (a === b) return true;
    if (typeof a === 'object' || typeof b === 'object') return a === b;
    return toNum(a) === toNum(b);
  }
  function numCmp(a, b) {
    if (typeof a === 'string' || typeof b === 'string') return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
    return toNum(a) - toNum(b);
  }

  // --- вычисление выражений ------------------------------------------
  // GML exposes the mask box as instance variables: `Pers_Obj.bbox_bottom`
  // must work exactly like the bare name inside the instance.
  function memberGet(obj, name) {
    if (name === 'speed') return MM.motionSpeed(obj);
    if (name === 'direction') return MM.motionDirection(obj);
    if (name === 'bbox_left' || name === 'bbox_right' || name === 'bbox_top' || name === 'bbox_bottom') {
      var bb = MM.bbox(obj);
      if (!bb) return 0;
      if (name === 'bbox_left') return bb.l;
      if (name === 'bbox_right') return bb.r;
      if (name === 'bbox_top') return bb.t;
      return bb.b;
    }
    var v = obj[name];
    return v === undefined ? 0 : v;
  }

  function evalExpr(node, ctx) {
    switch (node.type) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'id': return identValue(node.name, ctx);
      case 'member': {
        var obj = instTarget(evalExpr(node.obj, ctx));
        if (obj == null) return 0;
        if (typeof obj !== 'object') return 0;
        return memberGet(obj, node.name);
      }
      case 'index': {
        var base = instTarget(evalExpr(node.obj, ctx));
        if (base == null) return 0;
        var i0 = evalExpr(node.indices[0], ctx);
        if (node.indices.length === 1) {
          var r = base[i0];
          return r === undefined ? 0 : r;
        }
        var sub = base[i0];
        if (sub == null) return 0;
        var r2 = sub[evalExpr(node.indices[1], ctx)];
        return r2 === undefined ? 0 : r2;
      }
      case 'call': return evalCall(node, ctx);
      case 'bin': {
        var l = evalExpr(node.l, ctx);
        if (node.op === '&&' && !truthy(l)) return 0;
        if (node.op === '||' && truthy(l)) return 1;
        var rr = evalExpr(node.r, ctx);
        return binOp(node.op, l, rr);
      }
      case 'un': {
        if (node.op === '++' || node.op === '--') {
          var v1 = toNum(lvalueGet(node.e, ctx)) + (node.op === '++' ? 1 : -1);
          lvalueSet(node.e, ctx, v1);
          return v1;
        }
        var e = evalExpr(node.e, ctx);
        if (node.op === '-') return -toNum(e);
        if (node.op === '!') return truthy(e) ? 0 : 1;
        if (node.op === '~') return ~toNum(e);
        return 0;
      }
      case 'postfix': {
        var old = toNum(lvalueGet(node.target, ctx));
        lvalueSet(node.target, ctx, old + (node.op === '++' ? 1 : -1));
        return old;
      }
      case 'assign': {
        var nv;
        if (node.op === '=') nv = evalExpr(node.value, ctx);
        else {
          var cur = lvalueGet(node.target, ctx);
          var rhs = evalExpr(node.value, ctx);
          nv = binOp(node.op[0], cur, rhs);
        }
        lvalueSet(node.target, ctx, nv);
        return nv;
      }
    }
    MM.warn('Неизвестный тип узла: ' + node.type);
    return 0;
  }

  // --- выполнение операторов -----------------------------------------
  function execNode(node, ctx) {
    switch (node.type) {
      case 'block': {
        var b = node.body;
        for (var i = 0; i < b.length; i++) execNode(b[i], ctx);
        return;
      }
      case 'empty': return;
      case 'vardecl': {
        for (var j = 0; j < node.names.length; j++) {
          var nm = node.names[j];
          var val = nm.init ? evalExpr(nm.init, ctx) : 0;
          ctx.scope.vars[nm.name] = val;
        }
        return;
      }
      case 'globalvar': {
        for (var k = 0; k < node.names.length; k++) {
          MM.interp.globalNames[node.names[k]] = true;
          if (MM.globals[node.names[k]] === undefined) MM.globals[node.names[k]] = 0;
        }
        return;
      }
      case 'if': {
        if (truthy(evalExpr(node.cond, ctx))) execNode(node.then, ctx);
        else if (node.else) execNode(node.else, ctx);
        return;
      }
      case 'while': {
        while (truthy(evalExpr(node.cond, ctx))) {
          checkOps(ctx);
          try { execNode(node.body, ctx); }
          catch (sig) {
            if (sig === BREAK) break;
            if (sig === CONTINUE) continue;
            throw sig;
          }
        }
        return;
      }
      case 'repeat': {
        var n = Math.floor(toNum(evalExpr(node.count, ctx)));
        for (var r = 0; r < n; r++) {
          checkOps(ctx);
          try { execNode(node.body, ctx); }
          catch (sig) {
            if (sig === BREAK) break;
            if (sig === CONTINUE) continue;
            throw sig;
          }
        }
        return;
      }
      case 'for': {
        if (node.init) execNode(node.init, ctx);
        for (;;) {
          if (node.cond && !truthy(evalExpr(node.cond, ctx))) break;
          checkOps(ctx);
          try { execNode(node.body, ctx); }
          catch (sig) {
            if (sig === BREAK) break;
            if (sig === CONTINUE) { /* выполнить post */ }
            else throw sig;
          }
          if (node.post) evalExpr(node.post, ctx);
        }
        return;
      }
      case 'with': {
        var target = evalExpr(node.target, ctx);
        var list;
        if (target === MM.ALL) list = MM.query(MM.ALL);
        else list = MM.query(target);
        if (!list.length) return;
        list = list.slice();
        for (var w = 0; w < list.length; w++) {
          var inst = list[w];
          if (!inst || inst._destroyed) continue;
          checkOps(ctx);
          var child = {
            self: inst,
            other: ctx.self,
            scope: ctx.scope,
            name: ctx.name,
            ops: ctx.ops
          };
          try { execNode(node.body, child); }
          catch (sig) {
            if (sig === BREAK) break;
            if (sig === CONTINUE) continue;
            throw sig;
          }
        }
        return;
      }
      case 'break': throw BREAK;
      case 'continue': throw CONTINUE;
      case 'exit': throw EXIT;
      case 'return': {
        throw new ReturnSignal(node.value ? evalExpr(node.value, ctx) : undefined);
      }
      case 'expr': {
        evalExpr(node.expr, ctx);
        return;
      }
    }
    MM.warn('Неизвестный оператор: ' + node.type);
  }

  function checkOps(ctx) {
    var o = ctx.ops;
    o.count++;
    // A decompiled loop can spin forever on a collision condition the runner
    // evaluates differently.  Abort the event after a few seconds instead of
    // taking the whole tab down with it.
    if ((o.count & 2047) === 0) {
      var now = Date.now();
      if (!o.t0) o.t0 = now;
      else if (now - o.t0 > 4000) {
        o.t0 = now;
        throw new Error('MM: event runs too long (' + (ctx.name || '?') + ')');
      }
    }
    if (o.count > 20000000) {
      ctx.ops.count = 0;
      throw new Error('MM подозревает бесконечный цикл в ' + (ctx.name || '?'));
    }
  }

  // ===================================================================
  // ПУБЛИЧНЫЙ API
  // ===================================================================
  function compile(code, name) {
    // The AST only depends on the source text: several events share the same
    // source (identical Create/Step one-liners), so keying by code alone is
    // enough.  Keeping the per-name check re-parsed those events every frame.
    var key = String(code);
    var entry = cache.get(key);
    if (entry) return entry;
    entry = { ast: null, error: null, name: name };
    try {
      var lexer = new Lexer(String(code), name);
      var toks = lexer.tokenize();
      var parser = new Parser(toks, name);
      entry.ast = parser.parseProgram();
    } catch (err) {
      entry.error = err.message || String(err);
      entry.ast = null;
    }
    cache.set(key, entry);
    return entry;
  }

  MM.interp = {
    globalNames: globalNames,
    run: function (code, env) {
      env = env || {};
      var name = env.name || '<event>';
      var entry = compile(code, name);
      if (entry.error) {
        MM.warn('Ошибка синтаксиса [' + name + ']: ' + entry.error);
        return undefined;
      }
      var ctx = {
        self: env.self,
        other: env.other === undefined ? MM.NOONE : env.other,
        scope: new Scope(null),
        name: name,
        ops: { count: 0 }
      };
      try {
        execNode(entry.ast, ctx);
      } catch (sig) {
        if (sig instanceof ReturnSignal) return sig.value === undefined ? 0 : sig.value;
        if (sig instanceof ExitSignal) return 0;
        if (sig === BREAK || sig === CONTINUE) return 0;
        MM.warn('Ошибка выполнения [' + name + ']: ' + (sig && sig.message ? sig.message : String(sig)));
        return undefined;
      }
      return undefined;
    },
    check: function (code, name) {
      var entry = compile(code, name);
      return entry.error;
    },
    clearCache: function () { cache.clear(); warnedNames = Object.create(null); },
    parse: function (code, name) {
      var entry = compile(code, name || '<code>');
      return entry.error ? { error: entry.error, ast: null } : { error: null, ast: entry.ast };
    },
    runScript: function (name, self, other, args) {
      var entry = compile(MM.scripts[name], 'script:' + name);
      if (entry.error) { MM.warn('Скрипт ' + name + ': ' + entry.error); return 0; }
      return runScript(name, { self: self, other: other, ops: { count: 0 } }, args || []);
    },
    evalExprString: function (code, self) {
      var entry = compile('return (' + code + ');', '<eval>');
      if (entry.error) return { error: entry.error };
      return { value: MM.interp.run('return (' + code + ');', { self: self, name: '<eval>' }) };
    }
  };

})();
