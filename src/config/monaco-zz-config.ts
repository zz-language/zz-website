// Monaco language configuration for ZZ
export const zzMonarch = {
  keywords: [
    'func', 'struct', 'impl', 'import', 'mod', 'pub', 'use', 'enum', 'trait', 'type', 'const', 'mut',
    'if', 'else', 'for', 'while', 'return', 'break', 'continue', 'match', 'in',
    'self', 'true', 'false', 'null', 'none', 'some', 'ok', 'err',
  ],
  typeKeywords: ['int', 'float', 'str', 'string', 'bool', 'char', 'void', 'auto'],
  operators: [
    '=', '>', '<', '!', '~', '?', ':',
    '==', '<=', '>=', '!=', '&&', '||', '++', '--',
    '+', '-', '*', '/', '%', '**',
    '+=', '-=', '*=', '/=', '%=',
    '|>', '??', '->',
  ],
  symbols: /[=><!~?:&|+\-*/^%]+/,
  digits: /\d+(_+\d+)*/,
  tokenizer: {
    root: [
      // Comments
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, 'string', '@string'],
      // Numbers
      [/\d+\.\d+([eE][-+]?\d+)?/, 'number.float'],
      [/\d+/, 'number'],
      // Types (PascalCase)
      [/[A-Z][a-zA-Z0-9_]*/, 'type'],
      // Functions
      [/[a-z_][a-zA-Z0-9_]*(?=\s*\()/, 'function'],
      // Keywords
      [/\b(func|struct|impl|import|mod|pub|use|enum|trait|type|const|mut|if|else|for|while|return|break|continue|match|in|self|true|false|null|none|some|ok|err)\b/, 'keyword'],
      // sqlz!
      [/sqlz!/, 'keyword.sqlz'],
      // Operators
      [/[=><!~?:&|+\-*/^%]+/, 'operator'],
      // Pipe and elvis
      [/\|>/, 'operator.pipe'],
      [/\?\?/, 'operator.elvis'],
      // Identifiers
      [/[a-z_][a-zA-Z0-9_]*/, 'identifier'],
      // Whitespace
      [/\s+/, 'white'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
  },
};

export const zzLangConfig = {
  comments: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
};
