import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, BrainCircuit, Sparkles, User, Wand2 } from 'lucide-react';
import type { AgentState, LogEntry } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { useEditor } from '../lib/store.ts';
import { AgentPipeline } from './AgentPipeline.tsx';
import { AvatarBust } from './Avatar.tsx';

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'Disponível',
  analyzing: 'Assistindo o material',
  thinking: 'Pensando',
  cutting: 'Cortando',
  motion: 'Fazendo motion',
  celebrating: 'Concluiu!',
};

export interface Brain {
  kind: 'local' | 'claude';
  ready: boolean;
}

const SUGGESTIONS = ['Tira as pausas longas', 'Dá um zoom de 1.1 aqui', 'Restaura o último corte', 'Tira o trecho onde ele fala ""'];

export function AgentPanel({ brain }: { brain: Brain }) {
  const project = useEditor((s) => s.project);
  const logs = useEditor((s) => s.logs);
  const activity = useEditor((s) => s.activity);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [logs.length]);
  // Clique direito num clipe → "Pedir ao agente aqui": o pedido chega pré-preenchido.
  const draft = useEditor((s) => s.agentDraft);
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    useEditor.getState().askAgent(null);
    setTimeout(() => {
      const el = input.current;
      el?.focus();
      el?.setSelectionRange(draft.length, draft.length);
    }, 50);
  }, [draft]);

  const hasTranscript = project?.assets.some((a) => a.transcript);
  const busy = activity.state !== 'idle' && activity.state !== 'celebrating';

  const send = async () => {
    if (!project || !text.trim()) return;
    setError('');
    try {
      await api.command(project.id, text.trim(), useEditor.getState().playhead);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const decupar = async () => {
    if (!project) return;
    setError('');
    try {
      await api.decupar(project.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-850">
      {/* A foto do avatar + "Cérebro do Editor" é o botão da aba do grafo (#/cerebro). */}
      <a
        href="#/cerebro"
        className="group flex items-center gap-3 border-b border-ink-750 px-4 py-3 transition hover:bg-ink-800/60"
        title="Cérebro do Editor — o conhecimento e as notas conectadas, em 3D"
      >
        <div className="h-12 w-12 overflow-hidden rounded-xl bg-gradient-to-b from-nc-600/30 to-ink-800 ring-1 ring-ink-700 transition group-hover:ring-nc-500 group-hover:shadow-[0_0_14px_rgba(31,92,255,0.35)]">
          <AvatarBust state={activity.state === 'celebrating' ? 'celebrating' : 'idle'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span>
              NewEditor<span className="nc-text-gradient">.AI</span>
            </span>
            <span className="rounded-full border border-ink-600 px-1.5 py-px text-ui-2xs font-medium tracking-wide whitespace-nowrap text-ink-300 uppercase" title={brain.kind === 'local' ? 'Regras de edição em código — sem API, sem custo' : 'Usando a API da Anthropic'}>
              {brain.kind === 'local' ? 'local' : 'claude'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-ink-400">
            <span className={`h-1.5 w-1.5 rounded-full ${busy ? 'animate-pulse bg-cyan-nc' : 'bg-emerald-400'}`} />
            <span className="truncate">{activity.state === 'idle' ? STATE_LABEL.idle : activity.message || STATE_LABEL[activity.state]}</span>
          </div>
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-700 text-nc-300 transition group-hover:border-nc-500 group-hover:text-white" aria-hidden>
          <BrainCircuit size={14} />
        </span>
      </a>

      <div className="border-b border-ink-750 p-3">
        <button
          onClick={decupar}
          disabled={!hasTranscript || busy || !brain.ready}
          className="flex w-full items-center justify-center gap-2 rounded-lg nc-gradient px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-nc-600/25 transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          title={!hasTranscript ? 'Aguardando transcrição do material' : ''}
        >
          <Wand2 size={16} /> Decupar automaticamente
        </button>
        {!brain.ready && <p className="mt-2 text-ui-xs text-amber-300/90">Cérebro Claude ligado sem ANTHROPIC_API_KEY no .env.</p>}
      </div>

      <AgentPipeline />

      <div ref={feed} className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {logs.length === 0 && <p className="pt-6 text-center text-xs text-ink-400">O que o agente fizer aparece aqui, ao vivo.</p>}
        {logs.map((l) => (
          <LogItem key={l.id} entry={l} />
        ))}
      </div>

      <div className="border-t border-ink-750 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setText(s);
                input.current?.focus();
              }}
              className="rounded-full border border-ink-700 px-2 py-0.5 text-ui-xs text-ink-300 transition hover:border-nc-500 hover:text-white"
            >
              {s.trim()}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2 rounded-xl border border-ink-700 bg-ink-800 p-2 focus-within:border-nc-500">
          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
              e.stopPropagation();
            }}
            rows={2}
            placeholder="Peça uma alteração… (“tira a parte em que ele gagueja aqui”)"
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent text-sm text-ink-100 placeholder:text-ink-400 focus:outline-none"
          />
          <button aria-label="Enviar pedido ao agente" title="Enviar (Enter)" onClick={send} disabled={!text.trim() || !brain.ready} className="flex h-8 w-8 items-center justify-center rounded-lg nc-gradient text-white disabled:opacity-30">
            <ArrowUp size={16} />
          </button>
        </div>
        {error && <p className="mt-1.5 text-ui-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

function LogItem({ entry }: { entry: LogEntry }) {
  const isUrl = entry.text.startsWith('/media/');
  if (entry.by === 'human')
    return (
      <div className="anim-pop flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2 rounded-xl rounded-tr-sm bg-nc-600/25 px-3 py-2 text-ui-sm text-ink-100">
          <span>{entry.text}</span>
          <User size={13} className="mt-0.5 shrink-0 text-nc-300" />
        </div>
      </div>
    );
  return (
    <div className="anim-pop flex items-start gap-2 text-ui-sm leading-relaxed">
      {entry.by === 'agent' ? <Sparkles size={13} className="mt-1 shrink-0 text-cyan-nc" /> : <Bot size={13} className="mt-1 shrink-0 text-ink-400" />}
      {isUrl ? (
        <button onClick={() => window.dispatchEvent(new CustomEvent('neweditor:render', { detail: entry.text }))} className="rounded-md bg-nc-500/20 px-2 py-0.5 text-nc-300 hover:bg-nc-500/30">
          ▶ Ver vídeo exportado
        </button>
      ) : (
        <div className="min-w-0">
          <span className={`whitespace-pre-wrap ${entry.by === 'system' ? 'text-ink-400' : 'text-ink-200'}`}>{entry.text}</span>
          {entry.suggestion && <ApplySuggestion suggestion={entry.suggestion} />}
        </div>
      )}
    </div>
  );
}

/** Reescrita do LLM local: só muda a timeline quando o editor clica (ADR-0005). */
function ApplySuggestion({ suggestion }: { suggestion: NonNullable<LogEntry['suggestion']> }) {
  const project = useEditor((s) => s.project);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const apply = async () => {
    if (!project) return;
    try {
      await api.command(project.id, suggestion.text, suggestion.playhead ?? useEditor.getState().playhead);
      setState('sent');
    } catch {
      setState('error');
    }
  };
  return (
    <button onClick={apply} disabled={state === 'sent'} className="mt-1 block rounded-md bg-nc-500/20 px-2 py-0.5 text-ui-xs text-nc-300 hover:bg-nc-500/30 disabled:opacity-40">
      {state === 'sent' ? 'Aplicado' : state === 'error' ? 'Falhou, tentar de novo' : 'Aplicar'}
    </button>
  );
}
