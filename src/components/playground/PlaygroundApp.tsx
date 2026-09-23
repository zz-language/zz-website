import * as React from 'react';
import { runZZ } from '../../lib/zz/interpreter';
import { ZZ_EXAMPLES } from '../../lib/zz/examples';
import { zzMonarch, zzLangConfig } from '../../config/monaco-zz-config';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Select } from '../ui/select';
import { Separator } from '../ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

type LineKind = 'out' | 'err' | 'sys' | 'echo';
interface TermLine {
  id: number;
  kind: LineKind;
  text: string;
}

const MAX_LINES = 2000;

const lineClass: Record<LineKind, string> = {
  out: 'text-zinc-100',
  err: 'text-danger',
  sys: 'text-faint',
  echo: 'text-accent',
};

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}
function ClearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
function TerminalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-faint">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-faint">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

declare global {
  interface Window {
    monaco?: any;
    require?: any;
  }
}

function loadMonaco(): Promise<any> {
  if (window.monaco) return Promise.resolve(window.monaco);
  return new Promise((resolve, reject) => {
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js';
    loader.onload = () => {
      window.require.config({
        paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' },
      });
      window.require(['vs/editor/editor.main'], (m: any) => resolve(m), reject);
    };
    loader.onerror = () => reject(new Error('monaco failed to load'));
    document.head.appendChild(loader);
  });
}

export default function PlaygroundApp() {
  const [lines, setLines] = React.useState<TermLine[]>([]);
  const [status, setStatus] = React.useState('loading editor…');
  const [running, setRunning] = React.useState(false);
  // Always default on first render (SSR-safe); ?example= applies in an effect.
  const [exampleId, setExampleId] = React.useState(ZZ_EXAMPLES[0].id);
  const pendingExampleRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('example');
    if (wanted && ZZ_EXAMPLES.some((e) => e.id === wanted)) {
      pendingExampleRef.current = wanted;
      setExampleId(wanted);
    }
  }, []);
  const [prompting, setPrompting] = React.useState(false);
  const [promptValue, setPromptValue] = React.useState('');

  const editorHostRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const promptInputRef = React.useRef<HTMLInputElement>(null);
  const editorRef = React.useRef<any>(null);
  const idRef = React.useRef(0);
  const pendingRef = React.useRef<number | null>(null);
  const abortRef = React.useRef(false);
  const runningRef = React.useRef(false);
  const promptResolveRef = React.useRef<((v: string | null) => void) | null>(null);
  const truncatedRef = React.useRef(false);

  const nextId = () => ++idRef.current;

  const pushLine = React.useCallback((kind: LineKind, text: string) => {
    const id = nextId();
    setLines((prev) => {
      const next = [...prev, { id, kind, text }];
      if (next.length > MAX_LINES) {
        next.splice(0, next.length - MAX_LINES);
        if (!truncatedRef.current) {
          truncatedRef.current = true;
          next.unshift({ id: nextId(), kind: 'sys', text: '… older output truncated …' });
        }
      }
      return next;
    });
    return id;
  }, []);

  const appendOut = React.useCallback(
    (text: string, newline: boolean) => {
      if (text === '' && newline && pendingRef.current === null) {
        pushLine('out', ' ');
        return;
      }
      if (pendingRef.current === null) {
        pendingRef.current = nextId();
        const id = pendingRef.current;
        setLines((prev) => [...prev.slice(-MAX_LINES + 1), { id, kind: 'out', text }]);
      } else {
        const id = pendingRef.current;
        setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text: l.text + text } : l)));
      }
      if (newline) pendingRef.current = null;
    },
    [pushLine],
  );

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, prompting, promptValue]);

  const askInput = React.useCallback(
    (prompt: string) =>
      new Promise<string | null>((resolve) => {
        if (prompt) appendOut(prompt, false);
        promptResolveRef.current = resolve;
        setPromptValue('');
        setPrompting(true);
      }),
    [appendOut],
  );

  React.useEffect(() => {
    if (prompting) {
      const t = setTimeout(() => promptInputRef.current?.focus({ preventScroll: true }), 0);
      return () => clearTimeout(t);
    }
  }, [prompting]);

  const submitPrompt = React.useCallback(
    (value: string | null) => {
      const done = promptResolveRef.current;
      promptResolveRef.current = null;
      setPrompting(false);
      setPromptValue('');
      if (value !== null) pushLine('echo', value);
      done?.(value);
    },
    [pushLine],
  );

  const doRun = React.useCallback(async () => {
    if (runningRef.current || !editorRef.current) return;
    runningRef.current = true;
    setRunning(true);
    abortRef.current = false;
    pendingRef.current = null;
    truncatedRef.current = false;
    setLines([]);
    setStatus('running…');
    const t0 = performance.now();
    const io = {
      print: (t: string) => appendOut(t, false),
      printLine: (t: string) => appendOut(t, true),
      readLine: (prompt: string) => askInput(prompt),
      shouldAbort: () => abortRef.current,
    };
    try {
      const res = await runZZ(editorRef.current.getValue(), io);
      const ms = Math.max(1, Math.round(performance.now() - t0));
      pendingRef.current = null;
      if (res.ok) {
        pushLine('sys', `— done in ${ms}ms · ${res.steps} steps —`);
        setStatus(`done · ${ms}ms`);
      } else if (res.error && (res.error.message === 'execution stopped' || abortRef.current)) {
        pushLine('sys', '— stopped —');
        setStatus('stopped');
      } else if (res.error && res.error.message === 'input cancelled') {
        pushLine('sys', '— input cancelled —');
        setStatus('cancelled');
      } else if (res.error) {
        pushLine('err', res.error.line > 0 ? `error: ${res.error.message} (line ${res.error.line})` : `error: ${res.error.message}`);
        setStatus('error');
      }
    } catch (err: any) {
      pushLine('err', `error: ${String(err?.message ?? err)}`);
      setStatus('error');
    }
    runningRef.current = false;
    setRunning(false);
  }, [appendOut, askInput, pushLine]);

  const runRef = React.useRef(doRun);
  runRef.current = doRun;

  const doStop = React.useCallback(() => {
    if (!runningRef.current) return;
    abortRef.current = true;
    if (promptResolveRef.current) submitPrompt(null);
  }, [submitPrompt]);

  const doClear = React.useCallback(() => {
    if (runningRef.current) return;
    pendingRef.current = null;
    truncatedRef.current = false;
    setLines([]);
    setStatus('ready');
  }, []);

  const changeExample = React.useCallback(
    (id: string) => {
      if (runningRef.current) return;
      setExampleId(id);
      const ex = ZZ_EXAMPLES.find((e) => e.id === id);
      if (ex && editorRef.current) {
        editorRef.current.setValue(ex.code);
        pendingRef.current = null;
        truncatedRef.current = false;
        setLines([]);
        setStatus('ready');
      }
    },
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    const initial =
      ZZ_EXAMPLES.find((e) => e.id === (pendingExampleRef.current ?? exampleId)) ?? ZZ_EXAMPLES[0];
    loadMonaco()
      .then((monaco) => {
        if (cancelled) return;
        try {
          monaco.languages.register({ id: 'zz' });
          monaco.languages.setMonarchTokensProvider('zz', zzMonarch);
          monaco.languages.setLanguageConfiguration('zz', zzLangConfig);
        } catch {
          /* already registered */
        }
        editorRef.current = monaco.editor.create(editorHostRef.current, {
          value: initial.code,
          language: 'zz',
          theme: 'vs-dark',
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 12 },
        });
        editorRef.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
        setStatus('ready');
      })
      .catch(() => setStatus('editor failed to load'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      {/* ——— Toolbar ——— */}
      <div
        role="toolbar"
        aria-label="Playground controls"
        className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2"
      >
        <Select
          value={exampleId}
          onValueChange={changeExample}
          options={ZZ_EXAMPLES.map((e) => ({ value: e.id, label: e.label }))}
          ariaLabel="Load example"
          disabled={running}
          className="min-w-[11rem]"
        />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => runRef.current()} disabled={running} aria-label="Run program (Ctrl+Enter)">
                <PlayIcon />
                Run
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run program (Ctrl+Enter)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="danger" onClick={doStop} disabled={!running} aria-label="Stop program">
                <StopIcon />
                Stop
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop program</TooltipContent>
          </Tooltip>
        </div>
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" onClick={doClear} disabled={running} aria-label="Clear output">
              <ClearIcon />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear output</TooltipContent>
        </Tooltip>
        <span role="status" className="ml-auto px-2 font-mono text-xs text-faint">
          {status}
        </span>
      </div>

      {/* ——— Editor + terminal ——— */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl shadow-black/40">
          <div className="flex h-11 items-center border-b border-border px-4">
            <FileIcon />
            <span className="ml-2 font-mono text-xs text-faint">editor.zz</span>
          </div>
          <div ref={editorHostRef} className="h-[420px] md:h-[520px]" role="region" aria-label="ZZ code editor" />
        </div>

        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl shadow-black/40">
          <div className="flex h-11 items-center border-b border-border px-4">
            <TerminalIcon />
            <span className="ml-2 font-mono text-xs text-faint">output</span>
          </div>
          <div
            ref={scrollRef}
            onClick={() => {
              if (promptResolveRef.current) promptInputRef.current?.focus({ preventScroll: true });
            }}
            className="h-[420px] overflow-y-auto p-4 font-mono text-sm leading-6 md:h-[520px]"
          >
            <div role="log" aria-live="polite" aria-label="Program output">
              {lines.map((l) => (
                <div key={l.id} className={cn('whitespace-pre-wrap break-all', lineClass[l.kind])}>
                  {l.text === '' ? ' ' : l.text}
                </div>
              ))}
            </div>
            {prompting && (
              <div className="flex items-baseline">
                <span aria-hidden="true" className="whitespace-pre-wrap break-all text-zinc-100">
                  {promptValue}
                </span>
                <span className="zz-cursor" aria-hidden="true" />
                <input
                  ref={promptInputRef}
                  className="zz-stdin-capture"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label="Type program input and press Enter"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitPrompt(promptValue);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      submitPrompt(null);
                    }
                    e.stopPropagation();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
