import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Clapperboard, ListChecks } from 'lucide-react';
import type { AppNotification } from '@neweditor/core';
import { api } from '../lib/api.ts';
import { Button } from './ui.tsx';

const since = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};

/** Sino: "decupagem pronta para revisão", "edição pronta" — clicar abre o projeto. */
export function Notifications() {
  const [list, setList] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);
  const [toast, setToast] = useState<AppNotification | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .notifications()
        .then((l) => {
          // Notificação nova (depois de abrir a tela) aparece como aviso flutuante.
          if (seen.current) {
            const fresh = l.find((n) => !n.read && !seen.current!.has(n.id));
            if (fresh) setToast(fresh);
          }
          seen.current = new Set(l.map((n) => n.id));
          setList(l);
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, []);

  const unread = list.filter((n) => !n.read).length;
  const go = (n: AppNotification) => {
    void api.readNotifications([n.id]);
    setList((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    setOpen(false);
    setToast(null);
    location.hash = `#/p/${n.projectId}${n.kind === 'revisao' ? '/revisao' : ''}`;
  };
  const icon = (n: AppNotification) => (n.kind === 'revisao' ? <ListChecks size={14} className="text-amber-300" /> : <Clapperboard size={14} className="text-emerald-300" />);

  return (
    <div ref={box} className="relative">
      <button aria-label="Notificações" onClick={() => setOpen(!open)} className="relative rounded-lg p-2 text-ink-300 hover:bg-ink-800 hover:text-white" title="Notificações">
        <Bell size={17} />
        {unread > 0 && <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-ui-2xs font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="anim-pop absolute top-11 right-0 z-50 w-[340px] overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-750 px-3 py-2 text-xs font-semibold text-ink-200">
            Notificações
            {unread > 0 && (
              <button onClick={() => (void api.readNotifications(), setList((l) => l.map((x) => ({ ...x, read: true }))))} className="flex items-center gap-1 text-ui-xs font-normal text-ink-400 hover:text-white">
                <CheckCheck size={12} /> marcar como lidas
              </button>
            )}
          </div>
          <div className="scroll-thin max-h-[420px] overflow-y-auto">
            {!list.length && <p className="p-4 text-center text-ui-sm text-ink-400">Nada por aqui ainda.</p>}
            {list.map((n) => (
              <button key={n.id} onClick={() => go(n)} className={`flex w-full gap-2.5 border-b border-ink-800 px-3 py-2.5 text-left hover:bg-ink-800 ${n.read ? 'opacity-60' : ''}`}>
                <span className="mt-0.5">{icon(n)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-sm leading-snug text-ink-100">{n.text}</span>
                  <span className="text-ui-xs text-ink-400">{since(n.at)}</span>
                </span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-nc-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="anim-pop fixed right-5 bottom-5 z-[var(--z-toast)] flex max-w-sm items-start gap-2.5 rounded-[var(--radius-ui-lg)] border border-ink-600 bg-ink-850 p-3 text-left shadow-[var(--shadow-ui-2)]">
          <span className="mt-0.5">{icon(toast)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-ui-sm font-semibold text-white">{toast.kind === 'revisao' ? 'Decupagem para revisar' : 'Edição pronta'}</span>
            <span className="block text-ui-sm leading-snug text-ink-300">{toast.text}</span>
            <span className="mt-2 flex gap-1.5">
              <Button size="sm" variant="primary" onClick={() => go(toast)}>
                {toast.kind === 'revisao' ? 'Revisar agora' : 'Abrir'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setToast(null)}>
                Depois
              </Button>
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
