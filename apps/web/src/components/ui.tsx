/**
 * Componentes base do Editor Brain (docs/DESIGN-AUDITORIA.md): um botão, um botão de ícone com nome
 * acessível obrigatório e um controle de valor com slider + campo numérico. Tokens em styles.css.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { blurValue } from '../lib/rangeField.ts';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'nc-gradient text-white shadow-ui-1 hover:brightness-110',
  secondary: 'border border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-500 hover:bg-ink-750',
  ghost: 'text-ink-300 hover:bg-ink-750 hover:text-white',
  danger: 'border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
};
const SIZE = { sm: 'h-7 gap-1 px-2.5 text-ui-xs', md: 'h-9 gap-1.5 px-3.5 text-ui-sm' } as const;

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className = '', disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-ui-md font-semibold transition duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** Botão só de ícone: `label` vira nome acessível e dica. */
export function IconButton({ label, shortcut, active, children, className = '', ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & { label: string; shortcut?: string; active?: boolean }) {
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      {...rest}
      aria-label={label}
      aria-pressed={active}
      title={tip}
      className={`rounded-ui-md p-1.5 transition duration-[var(--dur-fast)] disabled:pointer-events-none disabled:opacity-30 ${active ? 'bg-nc-500/20 text-nc-300' : 'text-ink-300 hover:bg-ink-750 hover:text-white'} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Valor numérico com slider E campo para digitar (precisão de editor).
 * `onLive` acompanha o arraste (preview); `onCommit` grava uma vez ao soltar, Enter ou sair do campo.
 */
export function RangeField({ label, value, min, max, step, unit = '', digits, hint, onCommit, onLive, resetTo, icon }: { label: ReactNode; value: number; min: number; max: number; step: number; unit?: string; digits?: number; hint?: ReactNode; onCommit: (v: number) => void; onLive?: (v: number) => void; resetTo?: number; icon?: ReactNode }) {
  const dec = digits ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
  const [v, setV] = useState(value);
  const [text, setText] = useState(value.toFixed(dec));
  // Último valor gravado: com `onLive`, o `value` de fora muda durante o arraste e não serve de base.
  const saved = useRef(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    saved.current = value;
    setV(value);
    setText(value.toFixed(dec));
  }, [value, dec]);
  const clamp = (x: number) => Math.min(max, Math.max(min, Math.round(x / step) * step));
  const commit = (x: number) => {
    const c = +clamp(x).toFixed(dec);
    setV(c);
    setText(c.toFixed(dec));
    dragging.current = false;
    if (Math.abs(c - saved.current) > 1e-9) {
      saved.current = c;
      onCommit(c);
    }
  };
  const id = `rf-${String(label).replace(/\W+/g, '-')}`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-ui-xs text-ink-300">
        <label htmlFor={id} className="flex items-center gap-1.5" onDoubleClick={() => resetTo !== undefined && commit(resetTo)} title={resetTo !== undefined ? 'Duplo clique volta ao padrão' : undefined}>
          {icon}
          {label}
        </label>
        <span className="flex items-center gap-1">
          <input
            aria-label={`${String(label)} (valor)`}
            value={text}
            inputMode="decimal"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit(Number(text.replace(',', '.')) || 0);
              if (e.key === 'Escape') setText(v.toFixed(dec));
            }}
            onBlur={() => {
              // Só grava se o texto foi editado: sair do campo não corta um valor de fora da faixa (BL-0108).
              const x = blurValue(text, v.toFixed(dec));
              if (x !== null) commit(x);
            }}
            className="w-14 rounded-ui-sm border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-right font-mono text-ui-xs text-ink-100 focus:border-nc-500 focus:outline-none"
          />
          {unit && <span className="font-mono text-ui-xs text-ink-400">{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          setV(+e.target.value);
          setText((+e.target.value).toFixed(dec));
          onLive?.(+e.target.value);
        }}
        onMouseUp={() => commit(v)}
        onTouchEnd={() => commit(v)}
        onKeyUp={() => commit(v)}
        className="w-full accent-nc-500"
      />
      {hint && <p className="text-ui-xs leading-snug text-ink-400">{hint}</p>}
    </div>
  );
}

/**
 * Ação que pede confirmação no próprio botão (sem diálogo do sistema): o 1º clique arma, o 2º confirma.
 * `needsConfirm` falso executa direto.
 */
export function ConfirmButton({ onConfirm, confirmLabel, needsConfirm = true, children, ...rest }: Omit<Parameters<typeof Button>[0], 'onClick'> & { onConfirm: () => void; confirmLabel: ReactNode; needsConfirm?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      {...rest}
      variant={armed ? 'danger' : rest.variant}
      onClick={() => {
        if (needsConfirm && !armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
