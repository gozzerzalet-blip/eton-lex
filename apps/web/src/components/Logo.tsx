import { cn } from '../lib/utils';
import { TempleMark } from './TempleMark';

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border border-line/80 bg-paper text-fg shadow-[0_10px_24px_-18px_rgba(0,0,0,.6)]">
        <TempleMark className="h-[31px] w-[31px]" />
        <span className="pointer-events-none absolute inset-0 rounded-[14px] ring-1 ring-inset ring-white/60 dark:ring-white/10" />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[16px] tracking-[0.16em] text-fg">ETON LEX</div>
          <div className="mt-1.5 text-[8.5px] uppercase tracking-[0.24em] text-fg/40">El Derecho, a tu alcance</div>
        </div>
      )}
    </div>
  );
}
