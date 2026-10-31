import { useEffect, useState } from 'react';

export interface MenuItem {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}
interface MenuRequest {
  x: number;
  y: number;
  items: (MenuItem | 'sep')[];
}

/** Abre o menu de contexto do editor onde o mouse está (qualquer componente pode chamar). */
export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: (MenuItem | 'sep')[]): void {
  e.preventDefault();
  e.stopPropagation();
  window.dispatchEvent(new CustomEvent<MenuRequest>('ne:menu', { detail: { x: e.clientX, y: e.clientY, items } }));
}

/** O menu em si, montado uma vez na casca do editor. */
export function ContextMenu() {
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMenu((e as CustomEvent<MenuRequest>).detail);
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('ne:menu', on);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('ne:menu', on);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', close);
    };
  }, []);
  if (!menu) return null;
  const w = 240;
  const x = Math.min(menu.x, window.innerWidth - w - 8);
  const y = Math.min(menu.y, window.innerHeight - 8 - 36 * menu.items.length);
  return (
    <div role="menu" onMouseDown={(e) => e.stopPropagation()} className="anim-pop fixed z-[var(--z-popover)] min-w-[220px] rounded-ui-md border border-ink-600 bg-ink-850 p-1 shadow-ui-2" style={{ left: x, top: y, width: w }}>
      {menu.items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="my-1 h-px bg-ink-700" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              setMenu(null);
              it.onClick();
            }}
            className={`flex w-full items-center gap-2 rounded-ui-sm px-2 py-1.5 text-left text-ui-xs disabled:opacity-40 ${it.danger ? 'text-rose-300 hover:bg-rose-500/15' : 'text-ink-100 hover:bg-nc-500/25'}`}
          >
            <span className="w-4 text-ink-400">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <kbd className="font-mono text-ui-xs text-ink-400">{it.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
