import { describe, expect, test } from 'bun:test';
import { runZZ, formatZZ, type ZZIO } from './interpreter';
import { ZZ_EXAMPLES } from './examples';

interface Run {
  out: string[];
  ok: boolean;
  error?: { message: string; line: number };
}

async function run(src: string, inputs: string[] = [], maxSteps = 2000000): Promise<Run> {
  const out: string[] = [];
  let buffer = '';
  const queue = [...inputs];
  const io: ZZIO = {
    print: (t) => {
      buffer += t;
    },
    printLine: (t) => {
      out.push(buffer + t);
      buffer = '';
    },
    readLine: async (prompt) => {
      if (prompt) {
        out.push(buffer + prompt);
        buffer = '';
      }
      const next = queue.shift();
      if (next === undefined) throw new Error('test: out of inputs');
      out.push(next);
      return next;
    },
    shouldAbort: () => false,
  };
  const res = await runZZ(src, io, { maxSteps });
  if (buffer) out.push(buffer);
  return { out, ok: res.ok, error: res.error };
}

describe('playground examples (must all run)', () => {
  for (const ex of ZZ_EXAMPLES) {
    test(ex.id, async () => {
      const inputs = ex.id === 'hello' ? ['Ada'] : [];
      const r = await run(ex.code, inputs);
      expect(r.error).toBeUndefined();
      expect(r.ok).toBe(true);
    });
  }

  test('hello output', async () => {
    const r = await run(ZZ_EXAMPLES[0].code, ['Ada']);
    expect(r.out).toEqual(['What is your name? ', 'Ada', 'Hello, Ada!', '5! = 120']);
  });

  test('structs output', async () => {
    const r = await run(ZZ_EXAMPLES[1].code);
    expect(r.out).toEqual(['1. Ada <ada@example.com>', '2. Grace <grace@example.com>']);
  });

  test('pipeline math', async () => {
    const r = await run(ZZ_EXAMPLES[3].code);
    expect(r.out).toEqual([
      '5 |> add_one |> double |> triple = 36',
      '10 |> triple |> add_one |> double = 62',
      '10 |> add(5) = 15',
    ]);
  });

  test('match output', async () => {
    const r = await run(ZZ_EXAMPLES[4].code);
    expect(r.out).toEqual([
      '0 -> zero',
      '1 -> one',
      '2 -> many',
      '3 -> many',
      'Ada',
      'fallback',
      '3.14',
      'hex=ff oct=377 bin=11111111',
      'parsed: 42',
    ]);
  });
});

describe('semantics', () => {
  test('int division truncates', async () => {
    const r = await run('println(7 / 2)\nprintln(0 - 7 / 2)');
    expect(r.out).toEqual(['3', '-3']);
  });

  test('int parse to Option with ??', async () => {
    const r = await run('x := input("n: ") |> int() ?? 1\nprintln(x)', ['abc']);
    expect(r.out).toEqual(['n: ', 'abc', '1']);
    const r2 = await run('x := input("n: ") |> int() ?? 1\nprintln(x)', ['42']);
    expect(r2.out[2]).toBe('42');
  });

  test('elvis pass-through', async () => {
    const r = await run('println(42 ?? 0)');
    expect(r.out).toEqual(['42']);
  });

  test('truthiness: only false and .none are falsy', async () => {
    const r = await run('if 0 { println("zero-truthy") }\nif .none { println("bad") } else { println("none-falsy") }');
    expect(r.out).toEqual(['zero-truthy', 'none-falsy']);
  });

  test('impl methods with self', async () => {
    const r = await run(`struct Rectangle {width: int, height: int}
impl Rectangle {
    func area(self) -> int {
        return self.width * self.height
    }
}
rect := Rectangle{width: 3, height: 4}
println(rect.area())`);
    expect(r.out).toEqual(['12']);
  });

  test('closures capture environment', async () => {
    const r = await run('mult := 3\ntriple := |x: int| x * mult\nprintln(map(range(1, 4), triple))');
    expect(r.out).toEqual(['[3, 6, 9]']);
  });

  test('method syntax on str and vec', async () => {
    const r = await run('println("  hi  ".trim())\nprintln([3, 1, 2].sort())');
    expect(r.out).toEqual(['hi', '[1, 2, 3]']);
  });

  test('index assign + while countdown', async () => {
    const r = await run('a := [1, 2, 3]\na[0] = 99\nn := 3\nwhile n > 0 {\nprintln(n)\nn = n - 1\n}');
    expect(r.out).toEqual(['3', '2', '1']);
    void r;
  });

  test('unwrap_or on none', async () => {
    const r = await run('y := .none\nprintln(y.unwrap_or(7))');
    expect(r.out).toEqual(['7']);
  });

  test('const reassignment errors', async () => {
    const r = await run('const X = 1\nX = 2');
    expect(r.ok).toBe(false);
  });
});

describe('errors carry messages + lines', () => {
  test('undefined variable', async () => {
    const r = await run('x := 1\nprintln(y)');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('`y`');
    expect(r.error?.line).toBe(2);
  });

  test('index out of bounds', async () => {
    const r = await run('a := [1]\nprintln(a[5])');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('bounds');
  });

  test('non-exhaustive match', async () => {
    const r = await run('match 5 {\n0 => println("z")\n}');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('non-exhaustive');
  });

  test('division by zero', async () => {
    const r = await run('println(1 / 0)');
    expect(r.ok).toBe(false);
  });

  test('unterminated string', async () => {
    const r = await run('x := "oops');
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('unterminated');
  });

  test('infinite loop hits step limit', async () => {
    const r = await run('while true {\n}', [], 5000);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toContain('limit');
  });
});

describe('formatZZ', () => {
  test('float keeps decimal point', async () => {
    const r = await run('println(3.0)\nprintln(str(2.5))');
    expect(r.out).toEqual(['3.0', '2.5']);
  });
});
void formatZZ;
