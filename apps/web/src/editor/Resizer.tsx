/** Divisor arrastável entre painéis (vertical ou horizontal). */
export function Resizer({ axis, onDelta, onDone, className = '' }: { axis: 'x' | 'y'; onDelta: (px: number) => void; onDone?: () => void; className?: string }) {
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    const p0 = axis === 'x' ? e.clientX : e.clientY;
    let last = p0;
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: MouseEvent) => {
      const p = axis === 'x' ? ev.clientX : ev.clientY;
      onDelta(p - last);
      last = p;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onDone?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      onMouseDown={start}
      className={`group relative z-20 shrink-0 ${axis === 'x' ? 'w-[5px] cursor-col-resize' : 'h-[5px] cursor-row-resize'} ${className}`}
    >
      <div className={`absolute bg-nc-500 opacity-0 transition-opacity group-hover:opacity-70 group-active:opacity-100 ${axis === 'x' ? 'inset-y-0 left-[2px] w-px' : 'inset-x-0 top-[2px] h-px'}`} />
    </div>
  );
}
