/**
 * Minimal ZZ interpreter for the browser playground.
 *
 * Supports the core language subset: inferred/explicit declarations, functions
 * (incl. recursion, defaults, generics skipped), if/while/for, match on
 * literals + Option/Result variants, closures, pipelines (`|>`, incl. `_`
 * placeholders), elvis (`??`), string interpolation with format specs,
 * arrays, dicts, structs + impl methods, and the pure stdlib surface
 * (builtins, str/vec/math/encoding/json/io/env/time). I/O-bound natives
 * (http/fs/net/db) report "not available in the playground".
 *
 * Semantics follow the real compiler where the subset overlaps: truncating
 * integer division, `int()`/`float()` string parsing to Option, falsy =
 * `false` and `.none` only.
 */

export interface ZZIO {
  print(text: string): void;
  printLine(text: string): void;
  readLine(prompt: string): Promise<string | null>;
  shouldAbort(): boolean;
  yieldStep?(): Promise<void>;
}

export interface ZZRunResult {
  ok: boolean;
  error?: { message: string; line: number };
  steps: number;
}

export class ZZError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

const ABORT = new ZZError('execution stopped', 0);

type Tok = { t: string; v: string; line: number; s: number; e: number };

function lex(src: string, startLine = 1): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = startLine;
  const push = (t: string, v: string, s: number, e: number) => toks.push({ t, v, line, s, e });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      push('nl', '\n', i, i + 1);
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let raw = '"';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          raw += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === '\n') line++;
        raw += src[j];
        j++;
      }
      if (j >= src.length) throw new ZZError('unterminated string literal', line);
      raw += '"';
      push('str', raw, i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      if (c === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X' || src[j + 1] === 'o' || src[j + 1] === 'O' || src[j + 1] === 'b' || src[j + 1] === 'B')) {
        j += 2;
        while (j < src.length && /[0-9a-fA-F_]/.test(src[j])) j++;
        push('num', src.slice(i, j), i, j);
        i = j;
        continue;
      }
      while (j < src.length && /[0-9_]/.test(src[j])) j++;
      let isFloat = false;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) {
        isFloat = true;
        j++;
        while (j < src.length && /[0-9_]/.test(src[j])) j++;
      }
      if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] ?? '')) {
        isFloat = true;
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < src.length && /[0-9_]/.test(src[j])) j++;
      }
      push('num', src.slice(i, j), i, j);
      void isFloat;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      push('name', src.slice(i, j), i, j);
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    void three;
    const two = src.slice(i, i + 2);
    if ([':=', '==', '!=', '<=', '>=', '&&', '||', '??', '|>', '->', '**', '=>'].includes(two)) {
      push('sym', two, i, i + 2);
      i += 2;
      continue;
    }
    if ('=<>+-*/%!?:;,.()[]{}|'.includes(c)) {
      push('sym', c, i, i + 1);
      i++;
      continue;
    }
    throw new ZZError(`unexpected character \`${c}\``, line);
  }
  push('eof', '', i, i);
  return toks;
}

/* ——— AST ——— */

type Expr =
  | { k: 'lit'; v: Value; line: number }
  | { k: 'str'; raw: string; line: number }
  | { k: 'var'; name: string; line: number }
  | { k: 'arr'; items: Expr[]; line: number }
  | { k: 'dict'; pairs: { k: string; v: Expr }[]; line: number }
  | { k: 'structlit'; name: string; fields: { k: string; v: Expr }[]; line: number }
  | { k: 'closure'; params: Param[]; body: Stmt[]; line: number }
  | { k: 'un'; op: string; e: Expr; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'pipe'; target: Expr; call: Expr; line: number }
  | { k: 'call'; callee: Expr; args: Arg[]; line: number }
  | { k: 'method'; obj: Expr; name: string; args: Arg[]; line: number }
  | { k: 'index'; obj: Expr; idx: Expr; line: number }
  | { k: 'member'; obj: Expr; name: string; line: number }
  | { k: 'variant'; tag: string; args: Expr[]; line: number }
  | { k: 'placeholder'; line: number }
  | { k: 'if'; cond: Expr; then: Stmt[]; els: Stmt[] | IfStmt | null; line: number }
  | { k: 'match'; target: Expr; arms: { pat: Pattern; body: Stmt[] }[]; line: number };

type IfStmt = Extract<Stmt, { k: 'if' }>;

type Pattern =
  | { k: 'wild' }
  | { k: 'lit'; v: Value }
  | { k: 'variant'; tag: string; bindings: string[] }
  | { k: 'bind'; name: string };

interface Param {
  name: string;
  def?: Expr;
}
interface Arg {
  e: Expr;
  placeholder: boolean;
}

type Stmt =
  | { k: 'let'; name: string; value: Expr; line: number }
  | { k: 'decl'; name: string; value: Expr; line: number; constant: boolean }
  | { k: 'assign'; target: Expr; value: Expr; line: number }
  | { k: 'func'; name: string; params: Param[]; body: Stmt[]; line: number }
  | { k: 'return'; value: Expr | null; line: number }
  | { k: 'if'; cond: Expr; then: Stmt[]; els: Stmt[] | Stmt | null; line: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'for'; name: string; iter: Expr; body: Stmt[]; line: number }
  | { k: 'match'; target: Expr; arms: { pat: Pattern; body: Stmt[] }[]; line: number }
  | { k: 'struct'; name: string; line: number }
  | { k: 'impl'; name: string; methods: Extract<Stmt, { k: 'func' }>[]; line: number }
  | { k: 'expr'; e: Expr; line: number };

/* ——— Values ——— */

export type Value =
  | { k: 'int'; v: number }
  | { k: 'float'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'unit' }
  | { k: 'arr'; items: Value[] }
  | { k: 'dict'; m: Map<string, Value> }
  | { k: 'rec'; name: string; fields: Map<string, Value> }
  | { k: 'var'; tag: string; value?: Value }
  | { k: 'fn'; name: string; params: Param[]; body: Stmt[]; closure: Env }
  | { k: 'native'; name: string; impl: (args: Value[], ctx: Ctx) => Value | Promise<Value> }
  | { k: 'mod'; name: string; members: Map<string, Value> };

const UNIT: Value = { k: 'unit' };
const TRUE: Value = { k: 'bool', v: true };
const FALSE: Value = { k: 'bool', v: false };
const NONE: Value = { k: 'var', tag: 'none' };

class Env {
  constructor(
    public map: Map<string, Value> = new Map(),
    public parent: Env | null = null,
    public consts: Set<string> = new Set(),
  ) {}
  get(name: string): Value | undefined {
    // deno-lint-ignore no-this-alias
    let e: Env | null = this;
    while (e) {
      if (e.map.has(name)) return e.map.get(name);
      e = e.parent;
    }
    return undefined;
  }
  setExisting(name: string, v: Value): boolean {
    // deno-lint-ignore no-this-alias
    let e: Env | null = this;
    while (e) {
      if (e.map.has(name)) {
        if (e.consts.has(name)) return false;
        e.map.set(name, v);
        return true;
      }
      e = e.parent;
    }
    return false;
  }
}

interface Ctx {
  io: ZZIO;
  globals: Env;
  impls: Map<string, Value>;
  step(): Promise<void>;
  globalsEnv(): Env;
}

/* ——— Parser ——— */

class Parser {
  pos = 0;
  constructor(private toks: Tok[]) {}

  peek(): Tok {
    return this.toks[this.pos];
  }
  next(): Tok {
    const t = this.toks[this.pos];
    if (this.pos < this.toks.length - 1) this.pos++;
    return t;
  }
  /** Next non-newline token without consuming. */
  peekSig(): Tok {
    let p = this.pos;
    while (this.toks[p].t === 'nl') p++;
    return this.toks[p];
  }
  skipNL() {
    while (this.peek().t === 'nl') this.next();
  }
  atEnd(): boolean {
    return this.peekSig().t === 'eof';
  }
  expectSym(v: string): Tok {
    const t = this.peekSig();
    if ((t.t === 'sym' && t.v === v) || (t.t === 'name' && t.v === v)) {
      this.skipNL0();
      return this.next();
    }
    throw new ZZError(`expected \`${v}\` but found \`${t.v || t.t}\``, t.line);
  }
  /** Consume tokens up to (not incl.) current position newlines — used after expect lookahead. */
  skipNL0() {
    while (this.peek().t === 'nl') this.next();
  }
  /** Skip a type annotation until `= , ) {` or newline at depth 0. */
  skipType() {
    let depth = 0;
    let angle = 0;
    for (;;) {
      const t = this.peek();
      if (t.t === 'eof') return;
      if (t.t === 'nl' && depth === 0 && angle === 0) return;
      if (t.t === 'sym') {
        if (depth === 0 && angle === 0 && (t.v === '=' || t.v === ',' || t.v === '{' || t.v === '|')) return;
        if (t.v === '<' && depth === 0) {
          angle++;
          this.next();
          continue;
        }
        if (t.v === '>' && angle > 0 && depth === 0) {
          angle--;
          this.next();
          continue;
        }
        if ('([{'.includes(t.v)) depth++;
        if (')]}'.includes(t.v)) {
          if (depth === 0) return;
          depth--;
        }
      }
      this.next();
    }
  }

  parseProgram(): Stmt[] {
    const out: Stmt[] = [];
    while (!this.atEnd()) {
      this.skipNL();
      if (this.atEnd()) break;
      if (this.peekSig().t === 'sym' && this.peekSig().v === ';') {
        this.next();
        continue;
      }
      out.push(this.parseStmt());
    }
    return out;
  }

  parseStmt(inFunc = false): Stmt {
    this.skipNL();
    const t = this.peekSig();
    if (t.t === 'name') {
      switch (t.v) {
        case 'func':
          return this.parseFunc();
        case 'struct':
          return this.parseStruct();
        case 'impl':
          return this.parseImpl();
        case 'import':
          return this.parseImport();
        case 'return': {
          this.next();
          const line = t.line;
          const nt = this.peekSig();
          if (nt.t === 'nl' || nt.t === 'eof' || (nt.t === 'sym' && (nt.v === '}' || nt.v === ';'))) {
            return { k: 'return', value: null, line };
          }
          return { k: 'return', value: this.parseExpr(), line };
        }
        case 'if':
          return this.parseIf(inFunc) as Stmt;
        case 'while': {
          this.next();
          const cond = this.parseExpr();
          const body = this.parseBlock(inFunc);
          return { k: 'while', cond, body, line: t.line };
        }
        case 'for': {
          this.next();
          const v = this.peekSig();
          if (v.t !== 'name') throw new ZZError('expected loop variable after `for`', v.line);
          this.next();
          this.expectName('in');
          const iter = this.parseExpr();
          const body = this.parseBlock(inFunc);
          return { k: 'for', name: v.v, iter, body, line: t.line };
        }
        case 'match':
          return this.parseMatch(false, inFunc) as Stmt;
        case 'const': {
          this.next();
          const n = this.peekSig();
          if (n.t !== 'name') throw new ZZError('expected name after `const`', n.line);
          this.next();
          if (this.peekSig().t === 'sym' && this.peekSig().v === ':') {
            this.next();
            this.skipType();
          }
          this.expectSym('=');
          const value = this.parseExpr();
          return { k: 'decl', name: n.v, value, line: t.line, constant: true };
        }
      }
      // Declaration / assignment / expression-statement starting with a name.
      const save = this.pos;
      this.next();
      const nt = this.peekSig();
      if (nt.t === 'sym' && nt.v === ':=') {
        this.next();
        const value = this.parseExpr();
        return { k: 'let', name: t.v, value, line: t.line };
      }
      if (nt.t === 'sym' && nt.v === ':') {
        this.next();
        this.skipType();
        this.expectSym('=');
        const value = this.parseExpr();
        return { k: 'decl', name: t.v, value, line: t.line, constant: false };
      }
      // Assignment: name (. name | [ expr ])* = expr
      this.pos = save;
      const target = this.parseExpr();
      if (this.peekSig().t === 'sym' && this.peekSig().v === '=') {
        this.next();
        if (
          target.k !== 'var' &&
          target.k !== 'index' &&
          target.k !== 'member'
        ) {
          throw new ZZError('invalid assignment target', t.line);
        }
        const value = this.parseExpr();
        return { k: 'assign', target, value, line: t.line };
      }
      return { k: 'expr', e: target, line: t.line };
    }
    const e = this.parseExpr();
    return { k: 'expr', e, line: t.line };
  }

  expectName(v: string) {
    const t = this.peekSig();
    if (t.t !== 'name' || t.v !== v) throw new ZZError(`expected \`${v}\``, t.line);
    this.skipNL0();
    this.next();
  }

  parseFunc(): Extract<Stmt, { k: 'func' }> {
    const kw = this.next();
    const n = this.peekSig();
    if (n.t !== 'name') throw new ZZError('expected function name', n.line);
    this.skipNL0();
    this.next();
    // generics: skip <...>
    if (this.peekSig().t === 'sym' && this.peekSig().v === '<') {
      let d = 0;
      do {
        const x = this.next();
        if (x.t === 'sym' && x.v === '<') d++;
        if (x.t === 'sym' && x.v === '>') d--;
        if (x.t === 'eof') throw new ZZError('unterminated generic list', x.line);
      } while (d > 0);
    }
    this.expectSym('(');
    const params: Param[] = [];
    while (!(this.peekSig().t === 'sym' && this.peekSig().v === ')')) {
      const p = this.peekSig();
      if (p.t !== 'name') throw new ZZError('expected parameter name', p.line);
      this.next();
      if (this.peekSig().t === 'sym' && this.peekSig().v === ':') {
        this.next();
        this.skipType();
      }
      let def: Expr | undefined;
      if (this.peekSig().t === 'sym' && this.peekSig().v === '=') {
        this.next();
        def = this.parseExpr();
      }
      params.push({ name: p.v, def });
      if (this.peekSig().t === 'sym' && this.peekSig().v === ',') this.next();
      else break;
    }
    this.expectSym(')');
    if (this.peekSig().t === 'sym' && this.peekSig().v === '->') {
      this.next();
      this.skipType();
    }
    const body = this.parseBlock(true);
    return { k: 'func', name: n.v, params, body, line: kw.line };
  }

  parseStruct(): Stmt {
    const kw = this.next();
    const n = this.peekSig();
    if (n.t !== 'name') throw new ZZError('expected struct name', n.line);
    this.next();
    if (this.peekSig().t === 'sym' && this.peekSig().v === '{') {
      let d = 0;
      do {
        const x = this.next();
        if (x.t === 'sym' && x.v === '{') d++;
        if (x.t === 'sym' && x.v === '}') d--;
        if (x.t === 'eof') throw new ZZError('unterminated struct body', x.line);
      } while (d > 0);
    }
    return { k: 'struct', name: n.v, line: kw.line };
  }

  parseImpl(): Stmt {
    const kw = this.next();
    const n = this.peekSig();
    if (n.t !== 'name') throw new ZZError('expected type name after `impl`', n.line);
    this.next();
    this.expectSym('{');
    const methods: Extract<Stmt, { k: 'func' }>[] = [];
    for (;;) {
      this.skipNL();
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '}') {
        this.next();
        break;
      }
      if (t.t === 'eof') throw new ZZError('unterminated `impl` block', t.line);
      if (t.t === 'name' && t.v === 'func') methods.push(this.parseFunc());
      else throw new ZZError(`expected \`func\` in impl block, found \`${t.v || t.t}\``, t.line);
    }
    return { k: 'impl', name: n.v, methods, line: kw.line };
  }

  parseImport(): Stmt {
    const kw = this.next();
    while (!this.atEnd()) {
      const t = this.peek();
      if (t.t === 'nl' || (t.t === 'sym' && t.v === ';')) break;
      this.next();
    }
    return { k: 'expr', e: { k: 'lit', v: UNIT, line: kw.line }, line: kw.line };
  }

  parseIf(inFunc: boolean): Stmt | Expr {
    const kw = this.next();
    const cond = this.parseExpr();
    const then = this.parseBlock(inFunc);
    this.skipNL();
    let els: Stmt[] | Stmt | null = null;
    const t = this.peekSig();
    if (t.t === 'name' && t.v === 'else') {
      this.next();
      const n2 = this.peekSig();
      if (n2.t === 'name' && n2.v === 'if') {
        els = this.parseIf(inFunc) as Stmt;
      } else {
        els = this.parseBlock(inFunc);
      }
    }
    return { k: 'if', cond, then, els, line: kw.line };
  }

  parseBlock(inFunc: boolean): Stmt[] {
    this.expectSym('{');
    const out: Stmt[] = [];
    for (;;) {
      this.skipNL();
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '}') {
        this.next();
        break;
      }
      if (t.t === 'eof') throw new ZZError('unterminated block', t.line);
      if (t.t === 'sym' && t.v === ';') {
        this.next();
        continue;
      }
      out.push(this.parseStmt(inFunc));
    }
    return out;
  }

  parseMatch(asExpr: boolean, inFunc: boolean): Stmt | Expr {
    void asExpr;
    const kw = this.next();
    const target = this.parseExpr();
    this.expectSym('{');
    const arms: { pat: Pattern; body: Stmt[] }[] = [];
    for (;;) {
      this.skipNL();
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '}') {
        this.next();
        break;
      }
      if (t.t === 'eof') throw new ZZError('unterminated `match`', t.line);
      if (t.t === 'sym' && t.v === ',') {
        this.next();
        continue;
      }
      const pat = this.parsePattern();
      this.expectSym('=>');
      this.skipNL();
      let body: Stmt[];
      if (this.peekSig().t === 'sym' && this.peekSig().v === '{') {
        body = this.parseBlock(inFunc);
      } else {
        const e = this.parseExpr();
        body = [{ k: 'expr', e, line: e.line }];
      }
      arms.push({ pat, body });
    }
    return { k: 'match', target, arms, line: kw.line };
  }

  parsePattern(): Pattern {
    const t = this.peekSig();
    if (t.t === 'sym' && t.v === '_') {
      this.next();
      return { k: 'wild' };
    }
    if (t.t === 'num' || t.t === 'str') {
      this.next();
      return { k: 'lit', v: parseNumTok(t) };
    }
    if (t.t === 'name' && (t.v === 'true' || t.v === 'false')) {
      this.next();
      return { k: 'lit', v: t.v === 'true' ? TRUE : FALSE };
    }
    if (t.t === 'sym' && t.v === '.') {
      this.next();
      const n = this.peekSig();
      if (n.t !== 'name') throw new ZZError('expected variant name', n.line);
      this.next();
      const bindings: string[] = [];
      if (this.peekSig().t === 'sym' && this.peekSig().v === '(') {
        this.next();
        while (!(this.peekSig().t === 'sym' && this.peekSig().v === ')')) {
          const b = this.peekSig();
          if (b.t === 'sym' && b.v === '_') {
            this.next();
          } else if (b.t === 'name') {
            this.next();
            bindings.push(b.v);
          } else throw new ZZError('expected binding in pattern', b.line);
          if (this.peekSig().t === 'sym' && this.peekSig().v === ',') this.next();
          else break;
        }
        this.expectSym(')');
      }
      return { k: 'variant', tag: n.v, bindings };
    }
    if (t.t === 'name') {
      this.next();
      return { k: 'bind', name: t.v };
    }
    throw new ZZError(`invalid pattern near \`${t.v || t.t}\``, t.line);
  }

  /* ——— expressions (precedence climbing) ——— */

  parseExpr(): Expr {
    return this.parseOr();
  }
  /** `a |> f` binds tighter than `||` and `??`: operands are `&&`-level. */
  parsePipe(): Expr {
    let e = this.parseAnd();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '|>') {
        this.next();
        this.skipNL();
        const call = this.parseAnd();
        e = { k: 'pipe', target: e, call, line: t.line };
      } else return e;
    }
  }
  parseOr(): Expr {
    let e = this.parseElvis();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '||') {
        this.next();
        this.skipNL();
        e = { k: 'bin', op: '||', l: e, r: this.parseElvis(), line: t.line };
      } else return e;
    }
  }
  parseElvis(): Expr {
    const e = this.parsePipe();
    const t = this.peekSig();
    if (t.t === 'sym' && t.v === '??') {
      this.next();
      this.skipNL();
      const r = this.parseElvis();
      return { k: 'bin', op: '??', l: e, r, line: t.line };
    }
    return e;
  }
  parseAnd(): Expr {
    let e = this.parseEq();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '&&') {
        this.next();
        this.skipNL();
        e = { k: 'bin', op: '&&', l: e, r: this.parseEq(), line: t.line };
      } else return e;
    }
  }
  parseEq(): Expr {
    let e = this.parseCmp();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && (t.v === '==' || t.v === '!=')) {
        this.next();
        this.skipNL();
        e = { k: 'bin', op: t.v, l: e, r: this.parseCmp(), line: t.line };
      } else return e;
    }
  }
  parseCmp(): Expr {
    let e = this.parseAdd();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && ['<', '<=', '>', '>='].includes(t.v)) {
        this.next();
        this.skipNL();
        e = { k: 'bin', op: t.v, l: e, r: this.parseAdd(), line: t.line };
      } else return e;
    }
  }
  parseAdd(): Expr {
    let e = this.parseMul();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && (t.v === '+' || t.v === '-')) {
        this.next();
        this.skipNL();
        e = { k: 'bin', op: t.v, l: e, r: this.parseMul(), line: t.line };
      } else return e;
    }
  }
  parseMul(): Expr {
    let e = this.parsePow();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.next();
        this.skipNL();
        e = { k: 'bin', op: t.v, l: e, r: this.parsePow(), line: t.line };
      } else return e;
    }
  }
  parsePow(): Expr {
    const e = this.parseUnary();
    const t = this.peekSig();
    if (t.t === 'sym' && t.v === '**') {
      this.next();
      this.skipNL();
      return { k: 'bin', op: '**', l: e, r: this.parsePow(), line: t.line };
    }
    return e;
  }
  parseUnary(): Expr {
    const t = this.peekSig();
    if (t.t === 'sym' && (t.v === '!' || t.v === '-')) {
      this.next();
      this.skipNL();
      return { k: 'un', op: t.v, e: this.parseUnary(), line: t.line };
    }
    return this.parsePostfix();
  }
  parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '(') {
        this.next();
        const args = this.parseArgs();
        this.expectSym(')');
        e = { k: 'call', callee: e, args, line: t.line };
      } else if (t.t === 'sym' && t.v === '[') {
        this.next();
        const idx = this.parseExpr();
        this.expectSym(']');
        e = { k: 'index', obj: e, idx, line: t.line };
      } else if (t.t === 'sym' && t.v === '.') {
        this.next();
        const n = this.peekSig();
        if (n.t !== 'name') throw new ZZError('expected member name after `.`', n.line);
        this.next();
        if (this.peekSig().t === 'sym' && this.peekSig().v === '(') {
          this.next();
          const args = this.parseArgs();
          this.expectSym(')');
          e = { k: 'method', obj: e, name: n.v, args, line: n.line };
        } else {
          e = { k: 'member', obj: e, name: n.v, line: n.line };
        }
      } else return e;
    }
  }
  parseArgs(): Arg[] {
    const out: Arg[] = [];
    this.skipNL();
    while (!(this.peekSig().t === 'sym' && this.peekSig().v === ')')) {
      const t = this.peekSig();
      if (t.t === 'sym' && t.v === '_') {
        this.next();
        out.push({ e: { k: 'placeholder', line: t.line }, placeholder: true });
      } else {
        const e = this.parseExpr();
        out.push({ e, placeholder: false });
      }
      this.skipNL();
      if (this.peekSig().t === 'sym' && this.peekSig().v === ',') {
        this.next();
        this.skipNL();
      } else break;
    }
    return out;
  }

  parsePrimary(): Expr {
    const t = this.peekSig();
    if (t.t === 'num') {
      this.next();
      return { k: 'lit', v: parseNumTok(t), line: t.line };
    }
    if (t.t === 'str') {
      this.next();
      return { k: 'str', raw: t.v, line: t.line };
    }
    if (t.t === 'sym' && t.v === '_') {
      this.next();
      return { k: 'placeholder', line: t.line };
    }
    if (t.t === 'sym' && t.v === '.') {
      this.next();
      const n = this.peekSig();
      if (n.t !== 'name') throw new ZZError('expected variant name', n.line);
      this.next();
      if (this.peekSig().t === 'sym' && this.peekSig().v === '(') {
        this.next();
        const args = this.parseArgs();
        this.expectSym(')');
        return { k: 'variant', tag: n.v, args: args.map((a) => a.e), line: n.line };
      }
      return { k: 'variant', tag: n.v, args: [], line: n.line };
    }
    if (t.t === 'sym' && t.v === '(') {
      this.next();
      this.skipNL();
      const e = this.parseExpr();
      this.skipNL();
      this.expectSym(')');
      return e;
    }
    if (t.t === 'sym' && t.v === '[') {
      this.next();
      this.skipNL();
      const items: Expr[] = [];
      while (!(this.peekSig().t === 'sym' && this.peekSig().v === ']')) {
        items.push(this.parseExpr());
        this.skipNL();
        if (this.peekSig().t === 'sym' && this.peekSig().v === ',') {
          this.next();
          this.skipNL();
        } else break;
      }
      this.expectSym(']');
      return { k: 'arr', items, line: t.line };
    }
    if (t.t === 'sym' && t.v === '{') {
      // `{}` / `{"k": v}` → dict, else block expression.
      let q = this.pos;
      while (this.toks[q].t === 'nl') q++;
      let p = q + 1;
      while (this.toks[p].t === 'nl') p++;
      const a = this.toks[p];
      if ((a.t === 'sym' && a.v === '}') || (a.t === 'str' && this.tokAfterIs(p, ':'))) {
        this.next();
        this.skipNL();
        const pairs: { k: string; v: Expr }[] = [];
        while (!(this.peekSig().t === 'sym' && this.peekSig().v === '}')) {
          const ks = this.peekSig();
          if (ks.t !== 'str') throw new ZZError('expected string key in dict literal', ks.line);
          this.next();
          this.expectSym(':');
          pairs.push({ k: unescapeStr(ks.v), v: this.parseExpr() });
          this.skipNL();
          if (this.peekSig().t === 'sym' && this.peekSig().v === ',') {
            this.next();
            this.skipNL();
          } else break;
        }
        this.expectSym('}');
        return { k: 'dict', pairs, line: t.line };
      }
      // Block expression.
      this.next();
      const stmts: Stmt[] = [];
      for (;;) {
        this.skipNL();
        const x = this.peekSig();
        if (x.t === 'sym' && x.v === '}') {
          this.next();
          break;
        }
        if (x.t === 'eof') throw new ZZError('unterminated block', x.line);
        stmts.push(this.parseStmt(false));
      }
      void stmts;
      throw new ZZError('bare blocks are not expressions; use if/match or assign the value', t.line);
    }
    if (t.t === 'sym' && t.v === '|') {
      return this.parseClosure();
    }
    if (t.t === 'name') {
      switch (t.v) {
        case 'true':
          this.next();
          return { k: 'lit', v: TRUE, line: t.line };
        case 'false':
          this.next();
          return { k: 'lit', v: FALSE, line: t.line };
        case 'if':
          return this.parseIf(false) as Expr;
        case 'match':
          return this.parseMatch(true, false) as Expr;
        default: {
          this.next();
          // Struct literal only when `{` is adjacent (`User{...}`), so
          // `match x {`, `if c {`, `for x in y {` keep their brace.
          const nx = this.peek();
          if (nx.t === 'sym' && nx.v === '{' && nx.s === t.e) {
            // Struct literal: Name{...}
            this.next();
            this.skipNL();
            const fields: { k: string; v: Expr }[] = [];
            while (!(this.peekSig().t === 'sym' && this.peekSig().v === '}')) {
              const fk = this.peekSig();
              if (fk.t !== 'name') throw new ZZError('expected field name', fk.line);
              this.next();
              this.expectSym(':');
              fields.push({ k: fk.v, v: this.parseExpr() });
              this.skipNL();
              if (this.peekSig().t === 'sym' && this.peekSig().v === ',') {
                this.next();
                this.skipNL();
              } else break;
            }
            this.expectSym('}');
            return { k: 'structlit', name: t.v, fields, line: t.line };
          }
          return { k: 'var', name: t.v, line: t.line };
        }
      }
    }
    throw new ZZError(`unexpected \`${t.v || t.t}\``, t.line);
  }

  tokAfterIs(idx: number, sym: string): boolean {
    let p = idx + 1;
    while (this.toks[p].t === 'nl') p++;
    return this.toks[p].t === 'sym' && this.toks[p].v === sym;
  }

  parseClosure(): Expr {
    const bar = this.next();
    const params: Param[] = [];
    while (!(this.peekSig().t === 'sym' && this.peekSig().v === '|')) {
      const p = this.peekSig();
      if (p.t !== 'name') throw new ZZError('expected closure parameter', p.line);
      this.next();
      if (this.peekSig().t === 'sym' && this.peekSig().v === ':') {
        this.next();
        this.skipType();
      }
      params.push({ name: p.v });
      if (this.peekSig().t === 'sym' && this.peekSig().v === ',') this.next();
      else break;
    }
    this.expectSym('|');
    this.skipNL();
    const body: Stmt[] = [{ k: 'expr', e: this.parseExpr(), line: bar.line }];
    return { k: 'closure', params, body, line: bar.line };
  }
}

function parseNumTok(t: Tok): Value {
  const raw = t.v.replace(/_/g, '');
  if (t.t === 'str') return { k: 'str', v: unescapeStr(raw) };
  if (/^0[xX]/.test(raw)) return { k: 'int', v: parseInt(raw.slice(2), 16) };
  if (/^0[oO]/.test(raw)) return { k: 'int', v: parseInt(raw.slice(2), 8) };
  if (/^0[bB]/.test(raw)) return { k: 'int', v: parseInt(raw.slice(2), 2) };
  if (/[.eE]/.test(raw)) return { k: 'float', v: parseFloat(raw) };
  return { k: 'int', v: parseInt(raw, 10) };
}

function unescapeStr(raw: string): string {
  const inner = raw.slice(1, -1);
  return inner.replace(/\\(n|t|r|0|\\|"|_ts |\{|\})/g, (_m, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '0':
        return '\0';
      case '{':
        return '\u0001';
      case '}':
        return '\u0002';
      default:
        return ch;
    }
  });
}

/* ——— string interpolation ——— */

interface InterpPart {
  text?: string;
  expr?: string;
  spec?: string;
  line: number;
}

function splitInterp(s: string, baseLine: number): InterpPart[] {
  const parts: InterpPart[] = [];
  let i = 0;
  let buf = '';
  let bufLine = baseLine;
  let nl = 0;
  const flush = () => {
    if (buf) {
      parts.push({ text: buf, line: bufLine });
      buf = '';
    }
    bufLine = baseLine + nl;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '\u0001') {
      buf += '{';
      i++;
      continue;
    }
    if (c === '\u0002') {
      buf += '}';
      i++;
      continue;
    }
    if (c !== '{') {
      if (c === '\n') {
        nl++;
        bufLine = baseLine + nl;
      }
      buf += c;
      i++;
      continue;
    }
    // Find matching close brace at depth 0, respecting nested + strings.
    const partLine = baseLine + nl;
    let j = i + 1;
    let depth = 1;
    let inStr: string | null = null;
    while (j < s.length && depth > 0) {
      const d = s[j];
      if (d === '\n') nl++;
      if (inStr) {
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === inStr) inStr = null;
        j++;
        continue;
      }
      if (d === '"' || d === "'") {
        inStr = d;
        j++;
        continue;
      }
      if (d === '{') depth++;
      if (d === '}') depth--;
      j++;
    }
    if (depth !== 0) throw new ZZError('unterminated `{...}` in string', partLine);
    const inner = s.slice(i + 1, j - 1);
    // Split spec on first top-level `:`.
    let k = 0;
    let d2 = 0;
    let s2: string | null = null;
    let splitAt = -1;
    while (k < inner.length) {
      const ch = inner[k];
      if (s2) {
        if (ch === '\\') {
          k += 2;
          continue;
        }
        if (ch === s2) s2 = null;
        k++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        s2 = ch;
        k++;
        continue;
      }
      if (ch === '{' || ch === '(' || ch === '[') d2++;
      if (ch === '}' || ch === ')' || ch === ']') d2--;
      if (ch === ':' && d2 === 0) {
        splitAt = k;
        break;
      }
      k++;
    }
    flush();
    if (splitAt === -1) parts.push({ expr: inner, line: partLine });
    else parts.push({ expr: inner.slice(0, splitAt), spec: inner.slice(splitAt + 1), line: partLine });
    bufLine = baseLine + nl;
    i = j;
  }
  flush();
  return parts;
}

function applySpec(value: Value, spec: string, line: number): string {
  const m = spec.match(/^(\d*)(?:\.(\d+))?([a-zA-Z])?$/);
  if (!m) throw new ZZError(`unsupported format spec \`{...:${spec}}\``, line);
  const [, , prec, kind] = m;
  if (kind === 'f') {
    if (value.k !== 'float' && value.k !== 'int') throw new ZZError('`:f` needs a number', line);
    return value.v.toFixed(prec ? parseInt(prec, 10) : 6);
  }
  if (kind === 'x' || kind === 'X' || kind === 'o' || kind === 'b' || kind === 'd') {
    if (value.k !== 'int') throw new ZZError(`\`:${kind}\` needs an int`, line);
    const neg = value.v < 0;
    const a = Math.abs(Math.trunc(value.v));
    let out =
      kind === 'x'
        ? a.toString(16)
        : kind === 'X'
          ? a.toString(16).toUpperCase()
          : kind === 'o'
            ? a.toString(8)
            : kind === 'b'
              ? a.toString(2)
              : String(a);
    return neg ? '-' + out : out;
  }
  if (!kind) {
    if (prec) throw new ZZError(`unsupported format spec \`{...:${spec}}\``, line);
    return formatZZ(value);
  }
  throw new ZZError(`unsupported format spec \`{...:${spec}}\``, line);
}

/* ——— formatting / equality / truthiness ——— */

export function formatZZ(v: Value): string {
  switch (v.k) {
    case 'int':
      return String(Math.trunc(v.v));
    case 'float': {
      const s = String(v.v);
      return s.includes('.') || s.includes('e') || s.includes('E') ? s : s + '.0';
    }
    case 'str':
      return v.v;
    case 'bool':
      return v.v ? 'true' : 'false';
    case 'unit':
      return '()';
    case 'arr':
      return '[' + v.items.map(formatZZ).join(', ') + ']';
    case 'dict': {
      const parts: string[] = [];
      for (const [k, val] of v.m) parts.push(`"${k}": ${formatZZ(val)}`);
      return '{' + parts.join(', ') + '}';
    }
    case 'rec': {
      const parts: string[] = [];
      for (const [k, val] of v.fields) parts.push(`${k}: ${formatZZ(val)}`);
      return `${v.name}{${parts.join(', ')}}`;
    }
    case 'var':
      return v.value === undefined ? `.${v.tag}` : `.${v.tag}(${formatZZ(v.value)})`;
    case 'fn':
      return `<func ${v.name}>`;
    case 'native':
      return `<native ${v.name}>`;
    case 'mod':
      return `<mod ${v.name}>`;
  }
}

function zzEq(a: Value, b: Value): boolean {
  if ((a.k === 'int' || a.k === 'float') && (b.k === 'int' || b.k === 'float')) {
    return numVal(a) === numVal(b);
  }
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'int':
    case 'float':
      return a.v === (b as { v: number }).v;
    case 'str':
      return a.v === (b as { v: string }).v;
    case 'bool':
      return a.v === (b as { v: boolean }).v;
    case 'unit':
      return true;
    case 'arr': {
      const bb = b as { items: Value[] };
      return a.items.length === bb.items.length && a.items.every((x, i) => zzEq(x, bb.items[i]));
    }
    case 'var': {
      const bb = b as { tag: string; value?: Value };
      if (a.tag !== bb.tag) return false;
      if (a.value === undefined || bb.value === undefined) return a.value === bb.value;
      return zzEq(a.value, bb.value);
    }
    default:
      return false;
  }
}

function numVal(v: Value): number {
  if (v.k === 'int' || v.k === 'float') return v.v;
  throw new Error('not a number');
}

function truthy(v: Value): boolean {
  if (v.k === 'bool') return v.v;
  if (v.k === 'var' && v.tag === 'none') return false;
  return true;
}

function typeName(v: Value): string {
  switch (v.k) {
    case 'int':
      return 'int';
    case 'float':
      return 'float';
    case 'str':
      return 'str';
    case 'bool':
      return 'bool';
    case 'unit':
      return 'unit';
    case 'arr':
      return 'array';
    case 'dict':
      return 'dict';
    case 'rec':
      return v.name;
    case 'var':
      return v.tag === 'some' || v.tag === 'none' ? 'Option' : 'Result';
    case 'fn':
      return 'func';
    case 'native':
      return 'native';
    case 'mod':
      return 'mod';
  }
}

/* ——— stdlib ——— */

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function hexEncode(s: string): string {
  return [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexDecode(s: string): string {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(s)) throw new Error('invalid hex');
  const bytes = new Uint8Array(s.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

function numCmp(a: Value, b: Value): number {
  return numVal(a) - numVal(b);
}

function buildGlobals(ctx: Ctx): Env {
  const g = new Env();
  const N = (name: string, impl: (args: Value[], c: Ctx) => Value | Promise<Value>) =>
    g.map.set(name, { k: 'native', name, impl });

  const need = (args: Value[], n: number, name: string, line: number) => {
    if (args.length !== n) throw new ZZError(`${name} expects ${n} argument(s), got ${args.length}`, line);
  };

  N('println', (a, c) => {
    void c;
    ctx.io.printLine(a.map(formatZZ).join(' '));
    return UNIT;
  });
  N('print', (a) => {
    ctx.io.print(a.map(formatZZ).join(' '));
    return UNIT;
  });
  N('input', async (a) => {
    const prompt = a.length > 0 ? formatZZ(a[0]) : '';
    const s = await ctx.io.readLine(prompt);
    if (s === null) throw new ZZError('input cancelled', 0);
    return { k: 'str', v: s };
  });
  N('typeof', (a) => {
    if (a.length !== 1) throw new ZZError('typeof expects 1 argument', 0);
    return { k: 'str', v: typeName(a[0]) };
  });
  N('int', (a) => {
    if (a.length !== 1) throw new ZZError('int expects 1 argument', 0);
    const v = a[0];
    if (v.k === 'int') return v;
    if (v.k === 'float') return { k: 'int', v: Math.trunc(v.v) };
    if (v.k === 'str') {
      const t = v.v.trim();
      if (/^[+-]?\d+$/.test(t)) return { k: 'var', tag: 'some', value: { k: 'int', v: parseInt(t, 10) } };
      return NONE;
    }
    throw new ZZError(`cannot convert ${typeName(v)} to int`, 0);
  });
  N('float', (a) => {
    if (a.length !== 1) throw new ZZError('float expects 1 argument', 0);
    const v = a[0];
    if (v.k === 'float') return v;
    if (v.k === 'int') return { k: 'float', v: v.v };
    if (v.k === 'str') {
      const t = v.v.trim();
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t))
        return { k: 'var', tag: 'some', value: { k: 'float', v: parseFloat(t) } };
      return NONE;
    }
    throw new ZZError(`cannot convert ${typeName(v)} to float`, 0);
  });
  N('len', (a) => {
    if (a.length !== 1) throw new ZZError('len expects 1 argument', 0);
    const v = a[0];
    if (v.k === 'arr') return { k: 'int', v: v.items.length };
    if (v.k === 'str') return { k: 'int', v: [...v.v].length };
    if (v.k === 'dict') return { k: 'int', v: v.m.size };
    throw new ZZError(`len() not supported for ${typeName(v)}`, 0);
  });
  N('range', (a) => {
    let start = 0;
    let stop = 0;
    let step = 1;
    if (a.length === 1) {
      if (a[0].k !== 'int') throw new ZZError('range() needs int arguments', 0);
      stop = a[0].v;
    } else if (a.length === 2 || a.length === 3) {
      for (const x of a) if (x.k !== 'int') throw new ZZError('range() needs int arguments', 0);
      start = (a[0] as { v: number }).v;
      stop = (a[1] as { v: number }).v;
      if (a.length === 3) step = (a[2] as { v: number }).v;
    } else throw new ZZError('range() takes 1-3 arguments', 0);
    if (step === 0) throw new ZZError('range() step cannot be 0', 0);
    const out: Value[] = [];
    if (step > 0) for (let i = start; i < stop; i += step) out.push({ k: 'int', v: i });
    else for (let i = start; i > stop; i += step) out.push({ k: 'int', v: i });
    if (out.length > 1000000) throw new ZZError('range() too large', 0);
    return { k: 'arr', items: out };
  });

  const asFunc = (v: Value, line: number): Value => {
    if (v.k === 'fn' || v.k === 'native') return v;
    throw new ZZError(`expected function, found ${typeName(v)}`, line);
  };

  N('map', async (a, c) => {
    need(a, 2, 'map', 0);
    const arr = toArr(a[0], 'map', 0);
    const f = asFunc(a[1], 0);
    const out: Value[] = [];
    for (const x of arr) out.push(await callValue(f, [x], c, 0));
    return { k: 'arr', items: out };
  });
  N('filter', async (a, c) => {
    need(a, 2, 'filter', 0);
    const arr = toArr(a[0], 'filter', 0);
    const f = asFunc(a[1], 0);
    const out: Value[] = [];
    for (const x of arr) {
      const keep = await callValue(f, [x], c, 0);
      if (truthy(keep)) out.push(x);
    }
    return { k: 'arr', items: out };
  });
  N('enumerate', (a) => {
    need(a, 1, 'enumerate', 0);
    const arr = toArr(a[0], 'enumerate', 0);
    return {
      k: 'arr',
      items: arr.map((x, i) => ({ k: 'arr', items: [{ k: 'int', v: i }, x] }) as Value),
    };
  });
  N('zip', (a) => {
    need(a, 2, 'zip', 0);
    const x = toArr(a[0], 'zip', 0);
    const y = toArr(a[1], 'zip', 0);
    const n = Math.min(x.length, y.length);
    const out: Value[] = [];
    for (let i = 0; i < n; i++) out.push({ k: 'arr', items: [x[i], y[i]] });
    return { k: 'arr', items: out };
  });

  const mod = (name: string): Map<string, Value> => {
    const m = new Map<string, Value>();
    g.map.set(name, { k: 'mod', name, members: m });
    return m;
  };
  const M = (m: Map<string, Value>, name: string, impl: (args: Value[], c: Ctx) => Value | Promise<Value>) =>
    m.set(name, { k: 'native', name, impl });

  /* str */
  const strM = mod('str');
  const str1 = (name: string, fn: (s: string) => Value) =>
    M(strM, name, (a) => {
      if (a.length !== 1 || a[0].k !== 'str') throw new ZZError(`${name}(s: str)`, 0);
      return fn(a[0].v);
    });
  str1('length', (s) => ({ k: 'int', v: [...s].length }));
  str1('trim', (s) => ({ k: 'str', v: s.trim() }));
  str1('trim_start', (s) => ({ k: 'str', v: s.trimStart() }));
  str1('trim_end', (s) => ({ k: 'str', v: s.trimEnd() }));
  str1('to_upper', (s) => ({ k: 'str', v: s.toUpperCase() }));
  str1('to_lower', (s) => ({ k: 'str', v: s.toLowerCase() }));
  str1('reverse', (s) => ({ k: 'str', v: [...s].reverse().join('') }));
  str1('is_empty', (s) => (s.length === 0 ? TRUE : FALSE));
  M(strM, 'split', (a) => {
    if (a.length !== 2 || a[0].k !== 'str' || a[1].k !== 'str') throw new ZZError('split(s, sep)', 0);
    const [s, sep] = [a[0].v, a[1].v];
    const parts = sep === '' ? [...s] : s.split(sep);
    return { k: 'arr', items: parts.map((p) => ({ k: 'str', v: p }) as Value) };
  });
  M(strM, 'contains', (a) => {
    if (a.length !== 2 || a[0].k !== 'str' || a[1].k !== 'str') throw new ZZError('contains(s, sub)', 0);
    return a[0].v.includes(a[1].v) ? TRUE : FALSE;
  });
  M(strM, 'starts_with', (a) => {
    if (a.length !== 2 || a[0].k !== 'str' || a[1].k !== 'str') throw new ZZError('starts_with(s, prefix)', 0);
    return a[0].v.startsWith(a[1].v) ? TRUE : FALSE;
  });
  M(strM, 'ends_with', (a) => {
    if (a.length !== 2 || a[0].k !== 'str' || a[1].k !== 'str') throw new ZZError('ends_with(s, suffix)', 0);
    return a[0].v.endsWith(a[1].v) ? TRUE : FALSE;
  });
  M(strM, 'replace', (a) => {
    if (a.length !== 3 || a.some((x) => x.k !== 'str')) throw new ZZError('replace(s, old, new)', 0);
    return { k: 'str', v: (a[0] as { v: string }).v.split((a[1] as { v: string }).v).join((a[2] as { v: string }).v) };
  });
  M(strM, 'join', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr' || a[1].k !== 'str') throw new ZZError('join(arr, sep)', 0);
    return { k: 'str', v: a[0].items.map(formatZZ).join(a[1].v) };
  });
  M(strM, 'repeat', (a) => {
    if (a.length !== 2 || a[0].k !== 'str' || a[1].k !== 'int') throw new ZZError('repeat(s, n)', 0);
    if (a[1].v < 0) throw new ZZError('repeat() count must be >= 0', 0);
    return { k: 'str', v: a[0].v.repeat(Math.min(a[1].v, 1000000)) };
  });
  M(strM, 'count', (a) => {
    if (a.length !== 2 || a[0].k !== 'str' || a[1].k !== 'str') throw new ZZError('count(s, sub)', 0);
    if (!a[1].v) return { k: 'int', v: 0 };
    return { k: 'int', v: a[0].v.split(a[1].v).length - 1 };
  });
  M(strM, 'pad_left', (a) => {
    if (a.length !== 3 || a[0].k !== 'str' || a[1].k !== 'int' || a[2].k !== 'str')
      throw new ZZError('pad_left(s, len, pad)', 0);
    return { k: 'str', v: a[0].v.padStart(a[1].v, a[2].v || ' ') };
  });
  M(strM, 'pad_right', (a) => {
    if (a.length !== 3 || a[0].k !== 'str' || a[1].k !== 'int' || a[2].k !== 'str')
      throw new ZZError('pad_right(s, len, pad)', 0);
    return { k: 'str', v: a[0].v.padEnd(a[1].v, a[2].v || ' ') };
  });

  /* vec */
  const vecM = mod('vec');
  M(vecM, 'len', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.len(arr)', 0);
    return { k: 'int', v: a[0].items.length };
  });
  M(vecM, 'push', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr') throw new ZZError('vec.push(arr, x)', 0);
    return { k: 'arr', items: [...a[0].items, a[1]] };
  });
  M(vecM, 'append', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr') throw new ZZError('vec.append(arr, x)', 0);
    return { k: 'arr', items: [...a[0].items, a[1]] };
  });
  M(vecM, 'pop', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.pop(arr)', 0);
    return { k: 'arr', items: a[0].items.slice(0, -1) };
  });
  M(vecM, 'reverse', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.reverse(arr)', 0);
    return { k: 'arr', items: [...a[0].items].reverse() };
  });
  M(vecM, 'sort', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.sort(arr)', 0);
    return {
      k: 'arr',
      items: [...a[0].items].sort((x, y) => {
        if ((x.k === 'int' || x.k === 'float') && (y.k === 'int' || y.k === 'float')) return numVal(x) - numVal(y);
        return formatZZ(x) < formatZZ(y) ? -1 : 1;
      }),
    };
  });
  M(vecM, 'join', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr' || a[1].k !== 'str') throw new ZZError('vec.join(arr, sep)', 0);
    return { k: 'str', v: a[0].items.map(formatZZ).join(a[1].v) };
  });
  M(vecM, 'contains', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr') throw new ZZError('vec.contains(arr, x)', 0);
    return a[0].items.some((x) => zzEq(x, a[1])) ? TRUE : FALSE;
  });
  M(vecM, 'insert', (a) => {
    if (a.length !== 3 || a[0].k !== 'arr' || a[1].k !== 'int') throw new ZZError('vec.insert(arr, idx, x)', 0);
    const items = [...a[0].items];
    items.splice(Math.max(0, Math.min(a[1].v, items.length)), 0, a[2]);
    return { k: 'arr', items };
  });
  M(vecM, 'remove', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr' || a[1].k !== 'int') throw new ZZError('vec.remove(arr, idx)', 0);
    const items = [...a[0].items];
    if (a[1].v < 0 || a[1].v >= items.length) throw new ZZError('vec.remove(): index out of bounds', 0);
    items.splice(a[1].v, 1);
    return { k: 'arr', items };
  });
  const intArr = (a: Value[], name: string): number[] => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError(`${name}(arr)`, 0);
    return a[0].items.map((x) => {
      if (x.k !== 'int') throw new ZZError(`${name} needs [int]`, 0);
      return x.v;
    });
  };
  M(vecM, 'sum', (a) => ({ k: 'int', v: intArr(a, 'vec.sum').reduce((s, x) => s + x, 0) }));
  M(vecM, 'product', (a) => ({ k: 'int', v: intArr(a, 'vec.product').reduce((s, x) => s * x, 1) }));
  M(vecM, 'fold', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr' || a[1].k !== 'int') throw new ZZError('vec.fold(arr, init)', 0);
    return { k: 'int', v: a[0].items.reduce((s, x) => (x.k === 'int' ? s + x.v : s), a[1].v) };
  });
  M(vecM, 'concat', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr' || a[1].k !== 'arr') throw new ZZError('vec.concat(a, b)', 0);
    return { k: 'arr', items: [...a[0].items, ...a[1].items] };
  });
  M(vecM, 'flatten', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.flatten(arr)', 0);
    const out: Value[] = [];
    for (const x of a[0].items) {
      if (x.k !== 'arr') throw new ZZError('vec.flatten needs [[T]]', 0);
      out.push(...x.items);
    }
    return { k: 'arr', items: out };
  });
  M(vecM, 'index_of', (a) => {
    if (a.length !== 2 || a[0].k !== 'arr') throw new ZZError('vec.index_of(arr, x)', 0);
    const i = a[0].items.findIndex((x) => zzEq(x, a[1]));
    return { k: 'int', v: i };
  });
  M(vecM, 'min_val', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.min_val(arr)', 0);
    if (!a[0].items.length) return NONE;
    return { k: 'var', tag: 'some', value: a[0].items.reduce((m, x) => (numCmp(x, m) < 0 ? x : m)) };
  });
  M(vecM, 'max_val', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('vec.max_val(arr)', 0);
    if (!a[0].items.length) return NONE;
    return { k: 'var', tag: 'some', value: a[0].items.reduce((m, x) => (numCmp(x, m) > 0 ? x : m)) };
  });

  /* math */
  const mathM = mod('math');
  const math1 = (name: string, fn: (n: number) => Value, want: 'num' | 'int' = 'num') =>
    M(mathM, name, (a) => {
      if (a.length !== 1 || (a[0].k !== 'int' && a[0].k !== 'float')) throw new ZZError(`${name}(n)`, 0);
      if (want === 'int' && a[0].k !== 'int') throw new ZZError(`${name} needs int`, 0);
      return fn(a[0].v);
    });
  M(mathM, 'abs', (a) => {
    if (a.length !== 1) throw new ZZError('math.abs(v)', 0);
    const v = a[0];
    if (v.k === 'int') return { k: 'int', v: Math.abs(v.v) };
    if (v.k === 'float') return { k: 'float', v: Math.abs(v.v) };
    throw new ZZError('math.abs(v: int | float)', 0);
  });
  math1('floor', (n) => ({ k: 'int', v: Math.floor(n) }));
  math1('ceil', (n) => ({ k: 'int', v: Math.ceil(n) }));
  math1('sqrt', (n) => ({ k: 'float', v: Math.sqrt(n) }));
  M(mathM, 'pow', (a) => {
    if (a.length !== 2) throw new ZZError('math.pow(base, exp)', 0);
    return { k: 'float', v: Math.pow(numVal(a[0]), numVal(a[1])) };
  });
  M(mathM, 'random', (a) => {
    if (a.length !== 0) throw new ZZError('math.random() takes no arguments', 0);
    return { k: 'float', v: Math.random() };
  });
  math1('is_even', (n) => ((n / 2) * 2 === n ? TRUE : FALSE), 'int');
  math1('is_odd', (n) => ((n / 2) * 2 !== n ? TRUE : FALSE), 'int');
  M(mathM, 'min', (a) => {
    if (a.length !== 2) throw new ZZError('math.min(a, b)', 0);
    return numCmp(a[0], a[1]) <= 0 ? a[0] : a[1];
  });
  M(mathM, 'max', (a) => {
    if (a.length !== 2) throw new ZZError('math.max(a, b)', 0);
    return numCmp(a[0], a[1]) >= 0 ? a[0] : a[1];
  });
  M(mathM, 'clamp', (a) => {
    if (a.length !== 3) throw new ZZError('math.clamp(v, lo, hi)', 0);
    if (numCmp(a[0], a[1]) < 0) return a[1];
    if (numCmp(a[0], a[2]) > 0) return a[2];
    return a[0];
  });
  M(mathM, 'gcd', (a) => {
    if (a.length !== 2 || a[0].k !== 'int' || a[1].k !== 'int') throw new ZZError('math.gcd(a, b)', 0);
    let x = Math.abs(a[0].v);
    let y = Math.abs(a[1].v);
    while (y !== 0) [x, y] = [y, x % y];
    return { k: 'int', v: x };
  });
  M(mathM, 'factorial', (a) => {
    if (a.length !== 1 || a[0].k !== 'int' || a[0].v < 0) throw new ZZError('math.factorial(n >= 0)', 0);
    let r = 1;
    for (let i = 2; i <= a[0].v; i++) r *= i;
    return { k: 'int', v: r };
  });
  M(mathM, 'sum', (a) => ({ k: 'int', v: intArr(a, 'math.sum').reduce((s, x) => s + x, 0) }));
  M(mathM, 'mean_f', (a) => {
    if (a.length !== 1 || a[0].k !== 'arr') throw new ZZError('math.mean_f(arr)', 0);
    if (!a[0].items.length) return { k: 'var', tag: 'err', value: { k: 'str', v: 'mean: empty list' } };
    const s = a[0].items.reduce((t, x) => t + numVal(x), 0);
    return { k: 'var', tag: 'ok', value: { k: 'float', v: s / a[0].items.length } };
  });

  /* encoding */
  const encM = mod('encoding');
  M(encM, 'base64_encode', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('base64_encode(s)', 0);
    return { k: 'str', v: b64encode(a[0].v) };
  });
  M(encM, 'base64_decode', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('base64_decode(s)', 0);
    try {
      return { k: 'var', tag: 'ok', value: { k: 'str', v: b64decode(a[0].v) } };
    } catch {
      return { k: 'var', tag: 'err', value: { k: 'str', v: 'invalid base64' } };
    }
  });
  M(encM, 'hex_encode', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('hex_encode(s)', 0);
    return { k: 'str', v: hexEncode(a[0].v) };
  });
  M(encM, 'hex_decode', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('hex_decode(s)', 0);
    try {
      return { k: 'var', tag: 'ok', value: { k: 'str', v: hexDecode(a[0].v) } };
    } catch {
      return { k: 'var', tag: 'err', value: { k: 'str', v: 'invalid hex' } };
    }
  });
  M(encM, 'url_encode', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('url_encode(s)', 0);
    return { k: 'str', v: encodeURIComponent(a[0].v) };
  });
  M(encM, 'url_decode', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('url_decode(s)', 0);
    try {
      return { k: 'var', tag: 'ok', value: { k: 'str', v: decodeURIComponent(a[0].v) } };
    } catch {
      return { k: 'var', tag: 'err', value: { k: 'str', v: 'invalid encoding' } };
    }
  });

  /* json */
  const jsonM = mod('json');
  const fromJs = (x: unknown): Value => {
    if (x === null) return { k: 'var', tag: 'none' };
    if (typeof x === 'boolean') return x ? TRUE : FALSE;
    if (typeof x === 'number') return Number.isInteger(x) ? { k: 'int', v: x } : { k: 'float', v: x };
    if (typeof x === 'string') return { k: 'str', v: x };
    if (Array.isArray(x)) return { k: 'arr', items: x.map(fromJs) };
    if (typeof x === 'object') {
      const m = new Map<string, Value>();
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) m.set(k, fromJs(val));
      return { k: 'dict', m };
    }
    return NONE;
  };
  const toJs = (v: Value): unknown => {
    switch (v.k) {
      case 'int':
      case 'float':
        return v.v;
      case 'str':
        return v.v;
      case 'bool':
        return v.v;
      case 'unit':
        return null;
      case 'arr':
        return v.items.map(toJs);
      case 'dict': {
        const o: Record<string, unknown> = {};
        for (const [k, val] of v.m) o[k] = toJs(val);
        return o;
      }
      case 'var':
        return v.value === undefined ? null : toJs(v.value);
      default:
        return formatZZ(v);
    }
  };
  M(jsonM, 'parse', (a) => {
    if (a.length !== 1 || a[0].k !== 'str') throw new ZZError('json.parse(s)', 0);
    try {
      return fromJs(JSON.parse(a[0].v));
    } catch (e) {
      throw new ZZError(`json.parse: ${(e as Error).message}`, 0);
    }
  });
  M(jsonM, 'stringify', (a) => {
    if (a.length !== 1) throw new ZZError('json.stringify(v)', 0);
    return { k: 'str', v: JSON.stringify(toJs(a[0])) };
  });
  M(jsonM, 'pretty', (a) => {
    if (a.length !== 1) throw new ZZError('json.pretty(v)', 0);
    return { k: 'str', v: JSON.stringify(toJs(a[0]), null, 2) };
  });
  M(jsonM, 'get', (a) => {
    if (a.length !== 2 || a[1].k !== 'str') throw new ZZError('json.get(j, key)', 0);
    const o = a[0];
    if (o.k === 'dict') return o.m.get(a[1].v) ?? NONE;
    if (o.k === 'rec') return o.fields.get(a[1].v) ?? NONE;
    throw new ZZError('json.get needs an object', 0);
  });
  M(jsonM, 'has', (a) => {
    if (a.length !== 2 || a[1].k !== 'str') throw new ZZError('json.has(j, key)', 0);
    const o = a[0];
    if (o.k !== 'dict') throw new ZZError('json.has needs an object', 0);
    return o.m.has(a[1].v) ? TRUE : FALSE;
  });
  M(jsonM, 'keys', (a) => {
    if (a.length !== 1 || a[0].k !== 'dict') throw new ZZError('json.keys(j)', 0);
    return { k: 'arr', items: [...a[0].m.keys()].map((k) => ({ k: 'str', v: k }) as Value) };
  });
  const asX = (kind: 'str' | 'int' | 'float' | 'bool', name: string) =>
    M(jsonM, name, (a) => {
      if (a.length !== 1 || a[0].k !== kind) throw new ZZError(`${name} type mismatch`, 0);
      return a[0];
    });
  asX('str', 'as_str');
  asX('int', 'as_int');
  asX('float', 'as_float');
  asX('bool', 'as_bool');

  /* io */
  const ioM = mod('io');
  M(ioM, 'printz', (a) => {
    ctx.io.print(a.map(formatZZ).join(' '));
    return UNIT;
  });
  M(ioM, 'println', (a) => {
    ctx.io.printLine(a.map(formatZZ).join(' '));
    return UNIT;
  });
  M(ioM, 'read_line', async (a) => {
    if (a.length !== 0) throw new ZZError('io.read_line() takes no arguments', 0);
    const s = await ctx.io.readLine('');
    if (s === null) throw new ZZError('input cancelled', 0);
    return { k: 'str', v: s };
  });

  /* env / time (browser-safe) */
  const envM = mod('env');
  M(envM, 'get_var', () => NONE);
  M(envM, 'var', () => NONE);
  M(envM, 'args', () => ({ k: 'arr', items: [] }));
  const timeM = mod('time');
  M(timeM, 'now_ms', (a) => {
    if (a.length !== 0) throw new ZZError('time.now_ms() takes no arguments', 0);
    return { k: 'int', v: Date.now() };
  });
  M(timeM, 'sleep_ms', async (a) => {
    if (a.length !== 1) throw new ZZError('time.sleep_ms(ms)', 0);
    const ms = a[0];
    if (ms.k !== 'int') throw new ZZError('time.sleep_ms(ms)', 0);
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(ms.v, 5000))));
    return UNIT;
  });

  /* unavailable in browser */
  const nope = (label: string) => () => {
    throw new ZZError(`${label} needs real I/O and is not available in the playground`, 0);
  };
  for (const name of ['http', 'fs', 'net', 'db', 'sqlz']) mod(name);
  void nope;

  return g;
}

function toArr(v: Value, name: string, line: number): Value[] {
  if (v.k === 'arr') return v.items;
  throw new ZZError(`${name} expects an array, found ${typeName(v)}`, line);
}

/* ——— evaluator ——— */

class ReturnSignal {
  constructor(public value: Value) {}
}

async function callValue(fn: Value, args: Value[], ctx: Ctx, line: number): Promise<Value> {
  await ctx.step();
  if (fn.k === 'native') return fn.impl(args, ctx);
  if (fn.k !== 'fn') throw new ZZError(`not callable: ${typeName(fn)}`, line);
  const env = new Env(new Map(), fn.closure);
  for (let i = 0; i < fn.params.length; i++) {
    const p = fn.params[i];
    if (i < args.length) env.map.set(p.name, args[i]);
    else if (p.def) env.map.set(p.name, await evalExpr(p.def, ctx.globalsEnv(), ctx));
    else throw new ZZError(`missing argument \`${p.name}\``, line);
  }
  if (args.length > fn.params.length) throw new ZZError(`too many arguments for \`${fn.name}\``, line);
  try {
    return await evalBlock(fn.body, env, ctx);
  } catch (e) {
    if (e instanceof ReturnSignal) return e.value;
    throw e;
  }
}

async function evalBlock(stmts: Stmt[], env: Env, ctx: Ctx): Promise<Value> {
  let last: Value = UNIT;
  for (const s of stmts) last = await evalStmt(s, env, ctx);
  return last;
}

async function evalStmt(s: Stmt, env: Env, ctx: Ctx): Promise<Value> {
  await ctx.step();
  switch (s.k) {
    case 'let':
      env.map.set(s.name, await evalExpr(s.value, env, ctx));
      return UNIT;
    case 'decl': {
      const v = await evalExpr(s.value, env, ctx);
      env.map.set(s.name, v);
      if (s.constant) env.consts.add(s.name);
      return UNIT;
    }
    case 'assign': {
      const v = await evalExpr(s.value, env, ctx);
      const t = s.target;
      if (t.k === 'var') {
        if (!env.setExisting(t.name, v)) throw new ZZError(`undefined variable \`${t.name}\``, t.line);
        return v;
      }
      if (t.k === 'index') {
        const obj = await evalExpr(t.obj, env, ctx);
        const idx = await evalExpr(t.idx, env, ctx);
        if (obj.k === 'arr' && idx.k === 'int') {
          if (idx.v < 0 || idx.v >= obj.items.length) throw new ZZError('index out of bounds', t.line);
          obj.items[idx.v] = v;
          return v;
        }
        if (obj.k === 'dict' && idx.k === 'str') {
          obj.m.set(idx.v, v);
          return v;
        }
        throw new ZZError('invalid index assignment', t.line);
      }
      if (t.k === 'member') {
        const obj = await evalExpr(t.obj, env, ctx);
        if (obj.k === 'rec') {
          obj.fields.set(t.name, v);
          return v;
        }
        if (obj.k === 'dict') {
          obj.m.set(t.name, v);
          return v;
        }
        throw new ZZError('invalid field assignment', t.line);
      }
      throw new ZZError('invalid assignment target', s.line);
    }
    case 'func': {
      const f: Value = { k: 'fn', name: s.name, params: s.params, body: s.body, closure: env };
      env.map.set(s.name, f);
      return UNIT;
    }
    case 'return':
      throw new ReturnSignal(s.value ? await evalExpr(s.value, env, ctx) : UNIT);
    case 'if': {
      const c = await evalExpr(s.cond, env, ctx);
      if (truthy(c)) return evalBlock(s.then, new Env(new Map(), env), ctx);
      if (!s.els) return UNIT;
      if (Array.isArray(s.els)) return evalBlock(s.els, new Env(new Map(), env), ctx);
      return evalStmt(s.els, new Env(new Map(), env), ctx);
    }
    case 'while': {
      let last: Value = UNIT;
      for (;;) {
        const c = await evalExpr(s.cond, env, ctx);
        if (!truthy(c)) return last;
        last = await evalBlock(s.body, new Env(new Map(), env), ctx);
      }
    }
    case 'for': {
      const it = await evalExpr(s.iter, env, ctx);
      let items: Value[];
      if (it.k === 'arr') items = it.items;
      else if (it.k === 'str') items = [...it.v].map((ch) => ({ k: 'str', v: ch }) as Value);
      else throw new ZZError(`cannot iterate ${typeName(it)}`, s.line);
      let last: Value = UNIT;
      for (const x of items) {
        const scope = new Env(new Map([[s.name, x]]), env);
        last = await evalBlock(s.body, scope, ctx);
      }
      return last;
    }
    case 'match':
      return evalMatch(s.target, s.arms, env, ctx, s.line);
    case 'struct':
      return UNIT;
    case 'impl': {
      for (const m of s.methods) {
        const f: Value = { k: 'fn', name: m.name, params: m.params, body: m.body, closure: env };
        ctx.impls.set(`${s.name}.${m.name}`, f);
      }
      return UNIT;
    }
    case 'expr':
      return evalExpr(s.e, env, ctx);
  }
}

async function evalMatch(target: Expr, arms: { pat: Pattern; body: Stmt[] }[], env: Env, ctx: Ctx, line: number): Promise<Value> {
  const tv = await evalExpr(target, env, ctx);
  for (const arm of arms) {
    const bindings = matchPattern(arm.pat, tv);
    if (bindings) {
      const scope = new Env(new Map(Object.entries(bindings)), env);
      return evalBlock(arm.body, scope, ctx);
    }
  }
  throw new ZZError(`non-exhaustive match on \`${formatZZ(tv)}\``, line);
}

function matchPattern(pat: Pattern, v: Value): Record<string, Value> | null {
  switch (pat.k) {
    case 'wild':
      return {};
    case 'lit':
      return zzEq(pat.v, v) ? {} : null;
    case 'bind':
      return pat.name === '_' ? {} : { [pat.name]: v };
    case 'variant': {
      if (v.k !== 'var' || v.tag !== pat.tag) return null;
      const out: Record<string, Value> = {};
      if (pat.bindings.length === 0) return out;
      if (v.value === undefined) return null;
      // Single binding unwraps; multiple bindings need array payload.
      if (pat.bindings.length === 1) {
        const b = pat.bindings[0];
        if (b !== '_') out[b] = v.value;
        return out;
      }
      if (v.value.k !== 'arr' || v.value.items.length !== pat.bindings.length) return null;
      pat.bindings.forEach((b, i) => {
        if (b !== '_') out[b] = (v.value as { items: Value[] }).items[i];
      });
      return out;
    }
  }
}

function applyBinOp(op: string, l: Value, r: Value, line: number): Value {
  switch (op) {
    case '||':
      return truthy(l) ? l : r;
    case '&&':
      return truthy(l) ? r : l;
    case '??': {
      if (l.k === 'var' && (l.tag === 'some' || l.tag === 'ok')) return l.value ?? NONE;
      if (l.k === 'var' && (l.tag === 'none' || l.tag === 'err')) return r;
      return l;
    }
    case '==':
      return zzEq(l, r) ? TRUE : FALSE;
    case '!=':
      return zzEq(l, r) ? FALSE : TRUE;
  }
  if ((l.k === 'int' || l.k === 'float') && (r.k === 'int' || r.k === 'float')) {
    const a = numVal(l);
    const b = numVal(r);
    const bothInt = l.k === 'int' && r.k === 'int';
    switch (op) {
      case '+':
        return bothInt ? { k: 'int', v: a + b } : { k: 'float', v: a + b };
      case '-':
        return bothInt ? { k: 'int', v: a - b } : { k: 'float', v: a - b };
      case '*':
        return bothInt ? { k: 'int', v: a * b } : { k: 'float', v: a * b };
      case '/':
        if (b === 0) throw new ZZError('division by zero', line);
        return bothInt ? { k: 'int', v: Math.trunc(a / b) } : { k: 'float', v: a / b };
      case '%': {
        if (b === 0) throw new ZZError('modulo by zero', line);
        const q = Math.trunc(a / b);
        const m = a - q * b;
        return bothInt ? { k: 'int', v: m } : { k: 'float', v: m };
      }
      case '**': {
        if (bothInt && b >= 0 && Number.isInteger(b)) {
          let p = 1;
          for (let i = 0; i < b; i++) p *= a;
          return { k: 'int', v: p };
        }
        return { k: 'float', v: Math.pow(a, b) };
      }
      case '<':
        return a < b ? TRUE : FALSE;
      case '<=':
        return a <= b ? TRUE : FALSE;
      case '>':
        return a > b ? TRUE : FALSE;
      case '>=':
        return a >= b ? TRUE : FALSE;
    }
  }
  if (op === '+' && l.k === 'str' && r.k === 'str') return { k: 'str', v: l.v + r.v };
  if ((op === '<' || op === '<=' || op === '>' || op === '>=') && l.k === 'str' && r.k === 'str') {
    const c = l.v < r.v ? -1 : l.v > r.v ? 1 : 0;
    const ok = op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
    return ok ? TRUE : FALSE;
  }
  throw new ZZError(`cannot apply \`${op}\` to ${typeName(l)} and ${typeName(r)}`, line);
}

async function evalExpr(e: Expr, env: Env, ctx: Ctx): Promise<Value> {
  await ctx.step();
  switch (e.k) {
    case 'lit':
      return e.v;
    case 'var': {
      const v = env.get(e.name);
      if (v === undefined) throw new ZZError(`undefined variable \`${e.name}\``, e.line);
      return v;
    }
    case 'str': {
      const inner = unescapeStr(e.raw);
      if (!inner.includes('{')) return { k: 'str', v: inner };
      const parts = splitInterp(inner, e.line);
      let out = '';
      for (const p of parts) {
        if (p.text !== undefined) out += p.text;
        else {
          const sub = new Parser(lex(`(${p.expr})`, p.line));
          const subExpr = sub.parseExpr();
          let val: Value;
          try {
            val = await evalExpr(subExpr, env, ctx);
          } catch (err) {
            throw withLine(err, p.line);
          }
          out += p.spec !== undefined ? applySpec(val, p.spec, p.line) : formatZZ(val);
        }
      }
      return { k: 'str', v: out };
    }
    case 'arr': {
      const items: Value[] = [];
      for (const x of e.items) items.push(await evalExpr(x, env, ctx));
      return { k: 'arr', items };
    }
    case 'dict': {
      const m = new Map<string, Value>();
      for (const p of e.pairs) m.set(p.k, await evalExpr(p.v, env, ctx));
      return { k: 'dict', m };
    }
    case 'structlit': {
      const fields = new Map<string, Value>();
      for (const f of e.fields) fields.set(f.k, await evalExpr(f.v, env, ctx));
      return { k: 'rec', name: e.name, fields };
    }
    case 'closure':
      return { k: 'fn', name: '<closure>', params: e.params, body: e.body, closure: env };
    case 'un': {
      const v = await evalExpr(e.e, env, ctx);
      if (e.op === '!') return truthy(v) ? FALSE : TRUE;
      if (v.k === 'int') return { k: 'int', v: -v.v };
      if (v.k === 'float') return { k: 'float', v: -v.v };
      throw new ZZError(`cannot apply unary \`-\` to ${typeName(v)}`, e.line);
    }
    case 'bin': {
      // Short-circuit logical + elvis evaluate right side lazily.
      if (e.op === '||') {
        const l = await evalExpr(e.l, env, ctx);
        return truthy(l) ? l : evalExpr(e.r, env, ctx);
      }
      if (e.op === '&&') {
        const l = await evalExpr(e.l, env, ctx);
        return truthy(l) ? evalExpr(e.r, env, ctx) : l;
      }
      if (e.op === '??') {
        const l = await evalExpr(e.l, env, ctx);
        if (l.k === 'var' && (l.tag === 'some' || l.tag === 'ok')) return l.value ?? NONE;
        if (l.k === 'var' && (l.tag === 'none' || l.tag === 'err')) return evalExpr(e.r, env, ctx);
        return l;
      }
      const l = await evalExpr(e.l, env, ctx);
      const r = await evalExpr(e.r, env, ctx);
      return applyBinOp(e.op, l, r, e.line);
    }
    case 'pipe': {
      const target = await evalExpr(e.target, env, ctx);
      const c = e.call;
      if (c.k === 'call') return evalPipeCall(c.callee, c.args, target, env, ctx, e.line);
      if (c.k === 'method' && c.obj.k === 'var' && c.obj.name === '_')
        throw new ZZError('misplaced `_`', e.line);
      if (c.k === 'method') {
        const obj = await evalExpr(c.obj, env, ctx);
        const args = await evalPipeArgs(c.args, target, env, ctx, e.line);
        return evalMethod(obj, c.name, args, ctx, e.line);
      }
      // `x |> f` where f is a value: call f(x).
      const f = await evalExpr(c, env, ctx);
      return callValue(f, [target], ctx, e.line);
    }
    case 'call': {
      const callee = await evalExpr(e.callee, env, ctx);
      // `str(v)` converts to string while `str.*` are namespace calls.
      if (callee.k === 'mod') {
        if (callee.name === 'str' && e.args.length === 1 && !e.args[0].placeholder) {
          const v = await evalExpr(e.args[0].e, env, ctx);
          return { k: 'str', v: formatZZ(v) };
        }
        throw new ZZError(`\`${callee.name}\` is a module, not a function`, e.line);
      }
      const args: Value[] = [];
      for (const a of e.args) {
        if (a.placeholder) throw new ZZError('misplaced `_` (only valid after `|>` )', e.line);
        args.push(await evalExpr(a.e, env, ctx));
      }
      try {
        return await callValue(callee, args, ctx, e.line);
      } catch (err) {
        throw withLine(err, e.line);
      }
    }
    case 'method': {
      const obj = await evalExpr(e.obj, env, ctx);
      const args: Value[] = [];
      for (const a of e.args) {
        if (a.placeholder) throw new ZZError('misplaced `_` (only valid after `|>` )', e.line);
        args.push(await evalExpr(a.e, env, ctx));
      }
      try {
        return await evalMethod(obj, e.name, args, ctx, e.line);
      } catch (err) {
        throw withLine(err, e.line);
      }
    }
    case 'index': {
      const obj = await evalExpr(e.obj, env, ctx);
      const idx = await evalExpr(e.idx, env, ctx);
      if (obj.k === 'arr' && idx.k === 'int') {
        if (idx.v < 0 || idx.v >= obj.items.length) throw new ZZError('index out of bounds', e.line);
        return obj.items[idx.v];
      }
      if (obj.k === 'dict' && idx.k === 'str') return obj.m.get(idx.v) ?? NONE;
      if (obj.k === 'str' && idx.k === 'int') {
        const ch = [...obj.v][idx.v];
        if (ch === undefined) throw new ZZError('index out of bounds', e.line);
        return { k: 'str', v: ch };
      }
      throw new ZZError(`cannot index ${typeName(obj)}`, e.line);
    }
    case 'member': {
      const obj = await evalExpr(e.obj, env, ctx);
      if (obj.k === 'rec') {
        const v = obj.fields.get(e.name);
        if (v === undefined) throw new ZZError(`struct \`${obj.name}\` has no field \`${e.name}\``, e.line);
        return v;
      }
      if (obj.k === 'dict') return obj.m.get(e.name) ?? NONE;
      if (obj.k === 'mod') {
        const v = obj.members.get(e.name);
        if (v === undefined) throw new ZZError(`no function \`${obj.name}.${e.name}\``, e.line);
        return v;
      }
      throw new ZZError(`type ${typeName(obj)} has no member \`${e.name}\``, e.line);
    }
    case 'variant': {
      if (e.args.length === 0) return { k: 'var', tag: e.tag };
      if (e.args.length === 1) return { k: 'var', tag: e.tag, value: await evalExpr(e.args[0], env, ctx) };
      const items: Value[] = [];
      for (const a of e.args) items.push(await evalExpr(a, env, ctx));
      return { k: 'var', tag: e.tag, value: { k: 'arr', items } };
    }
    case 'placeholder':
      throw new ZZError('misplaced `_` (only valid after `|>` )', e.line);
    case 'if': {
      const c = await evalExpr(e.cond, env, ctx);
      if (truthy(c)) return evalBlock(e.then, new Env(new Map(), env), ctx);
      if (!e.els) return UNIT;
      if (Array.isArray(e.els)) return evalBlock(e.els, new Env(new Map(), env), ctx);
      return evalStmt(e.els, new Env(new Map(), env), ctx);
    }
    case 'match':
      return evalMatch(e.target, e.arms, env, ctx, e.line);
  }
}

async function evalPipeArgs(args: Arg[], target: Value, env: Env, ctx: Ctx, line: number): Promise<Value[]> {
  const out: Value[] = [];
  let placed = false;
  for (const a of args) {
    if (a.placeholder) {
      out.push(target);
      placed = true;
    } else out.push(await evalExpr(a.e, env, ctx));
  }
  if (!placed) out.unshift(target);
  void line;
  return out;
}

async function evalPipeCall(
  callee: Expr,
  args: Arg[],
  target: Value,
  env: Env,
  ctx: Ctx,
  line: number,
): Promise<Value> {
  // `x |> f(a)` / `x |> f(_, a)`. Callee may itself be member access (mod fn).
  const fn = await evalExpr(callee, env, ctx);
  const finalArgs = await evalPipeArgs(args, target, env, ctx, line);
  return callValue(fn, finalArgs, ctx, line);
}

async function evalMethod(obj: Value, name: string, args: Value[], ctx: Ctx, line: number): Promise<Value> {
  // Array methods (mutating append/push like the real runtime).
  if (obj.k === 'arr') {
    switch (name) {
      case 'append':
      case 'push':
        if (args.length !== 1) throw new ZZError(`.${name}(x) takes 1 argument`, line);
        obj.items.push(args[0]);
        return UNIT;
      case 'pop':
        obj.items.pop();
        return UNIT;
      case 'len':
        return { k: 'int', v: obj.items.length };
      default: {
        const v = ctx.globals.get('vec');
        if (v?.k === 'mod') {
          const f = v.members.get(name);
          if (f) return callValue(f, [obj, ...args], ctx, line);
        }
      }
    }
    throw new ZZError(`arrays have no method \`.${name}()\``, line);
  }
  if (obj.k === 'str') {
    const v = ctx.globals.get('str');
    if (v?.k === 'mod') {
      const f = v.members.get(name);
      if (f) return callValue(f, [obj, ...args], ctx, line);
    }
    throw new ZZError(`strings have no method \`.${name}()\``, line);
  }
  if (obj.k === 'var') {
    const v = obj.value;
    switch (name) {
      case 'unwrap':
        if ((obj.tag === 'some' || obj.tag === 'ok') && v !== undefined) return v;
        throw new ZZError(`called .unwrap() on \`.${obj.tag}\``, line);
      case 'unwrap_or':
        if (args.length !== 1) throw new ZZError('.unwrap_or(default)', line);
        return (obj.tag === 'some' || obj.tag === 'ok') && v !== undefined ? v : args[0];
      case 'expect':
        if (args.length !== 1 || args[0].k !== 'str') throw new ZZError('.expect(msg)', line);
        if ((obj.tag === 'some' || obj.tag === 'ok') && v !== undefined) return v;
        throw new ZZError(args[0].v, line);
    }
    throw new ZZError(`variants have no method \`.${name}()\``, line);
  }
  if (obj.k === 'rec') {
    const f = ctx.impls.get(`${obj.name}.${name}`);
    if (f) return callValue(f, [obj, ...args], ctx, line);
    throw new ZZError(`no method \`.${name}()\` on struct \`${obj.name}\``, line);
  }
  if (obj.k === 'dict' && name === 'len') {
    void args;
    return { k: 'int', v: obj.m.size };
  }
  throw new ZZError(`type ${typeName(obj)} has no method \`.${name}()\``, line);
}

/* ——— entry ——— */

export async function runZZ(source: string, io: ZZIO, opts?: { maxSteps?: number }): Promise<ZZRunResult> {
  const maxSteps = opts?.maxSteps ?? 2000000;
  let steps = 0;
  const yieldStep = io.yieldStep ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  const impls = new Map<string, Value>();
  // Declared before the literal so `globalsEnv` can close over the binding;
  // assigned below once `buildGlobals` (which needs `ctx`) returns.
  let globals!: Env;
  const ctx: Ctx = {
    io,
    globals: undefined as unknown as Env,
    impls,
    globalsEnv: () => globals,
    step: async () => {
      steps++;
      if (steps > maxSteps) throw new ZZError('execution limit exceeded (possible infinite loop)', 0);
      if ((steps & 1023) === 0) {
        if (io.shouldAbort()) throw ABORT;
        await yieldStep();
      }
    },
  };
  // Attach globals lazily so natives can reference ctx.globals.
  globals = buildGlobals(ctx);
  ctx.globals = globals;
  try {
    const stmts = new Parser(lex(source)).parseProgram();
    await evalBlock(stmts, globals, ctx);
    return { ok: true, steps };
  } catch (e) {
    if (e === ABORT || (e instanceof ZZError && e.message === 'execution stopped')) {
      return { ok: false, error: { message: 'execution stopped', line: 0 }, steps };
    }
    if (e instanceof ZZError) return { ok: false, error: { message: e.message, line: e.line }, steps };
    if (e instanceof ReturnSignal) return { ok: false, error: { message: '`return` outside function', line: 0 }, steps };
    return { ok: false, error: { message: String(e), line: 0 }, steps };
  }
}

/** Give line-0 runtime errors the call-site line for better messages. */
function withLine(err: unknown, line: number): unknown {
  if (err instanceof ZZError && err.line === 0 && line !== 0) {
    return new ZZError(err.message, line);
  }
  return err;
}
