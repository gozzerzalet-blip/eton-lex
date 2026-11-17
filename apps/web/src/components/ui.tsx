import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn, initials } from '../lib/utils';

export function Avatar({ name, url, size = 36, className }: { name?: string | null; url?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-gradient-to-br from-graphite-500 to-graphite-900 font-medium text-white shadow-[0_6px_16px_-12px_rgba(0,0,0,.8)] dark:border-white/15',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'gold'; className?: string }) {
  const tones: Record<string, string> = {
    neutral: 'border-line text-fg/60 bg-white/45 dark:bg-white/[.04]',
    success: 'border-fg/15 text-fg bg-fg/[.06]',
    warn: 'border-dashed border-fg/30 text-fg/75 bg-transparent',
    danger: 'border-transparent bg-fg text-paper',
    info: 'border-fg/10 text-fg/70 bg-fg/[.03]',
    gold: 'border-fg/20 text-fg/80 bg-transparent',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-block animate-spin rounded-full border-2 border-fg/20 border-t-fg', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Cargando"
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/30 px-6 py-14 text-center dark:bg-white/[.02]">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-white/60 text-fg/50 shadow-sm dark:bg-white/[.05]">{icon}</div>}
      <h3 className="font-display text-xl text-fg/90">{title}</h3>
      {description && <p className="mt-1.5 max-w-md text-sm text-fg/45">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; width?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/25 p-0 backdrop-blur-md sm:items-center sm:p-6 dark:bg-black/50"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={cn('glass w-full rounded-t-3xl p-5 shadow-lift sm:rounded-3xl sm:p-6', width)}
            initial={{ y: 24, opacity: 0, scale: 0.99 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              {title && <h2 className="font-display text-2xl text-fg/95">{title}</h2>}
              <button onClick={onClose} className="btn btn-ghost btn-sm ml-auto" aria-label="Cerrar"><X size={16} /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SectionHeader({ eyebrow, title, action, description }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-fg/35">{eyebrow}</p>}
        <h1 className="font-display text-[30px] leading-[1.1] text-fg sm:text-[36px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-fg/45">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: string; count?: number }>; className?: string }) {
  return (
    <div className={cn('inline-flex flex-wrap gap-1 rounded-full border border-line bg-white/45 p-1 backdrop-blur-xl dark:bg-white/[.04]', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
            value === item.id ? 'bg-fg text-paper shadow-sm' : 'text-fg/50 hover:text-fg/90',
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="ml-1.5 opacity-50">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
