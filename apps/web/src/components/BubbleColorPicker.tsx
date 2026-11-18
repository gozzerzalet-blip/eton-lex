import { Check, RotateCcw } from 'lucide-react';
import { BUBBLE_PALETTES, bubbleStyle, bubbleTextColor, type BubbleColors } from '../lib/bubbleColors';
import { cn } from '../lib/utils';

type Props = {
  value: BubbleColors;
  onChange: (next: BubbleColors) => void;
  onReset: () => void;
  saving?: boolean;
};

function ColorRow({
  title,
  description,
  kind,
  value,
  onChange,
}: {
  title: string;
  description: string;
  kind: keyof BubbleColors;
  value: BubbleColors;
  onChange: (next: BubbleColors) => void;
}) {
  return (
    <div>
      <p className="text-[11.5px] font-medium text-fg/75">{title}</p>
      <p className="mt-0.5 text-[10px] text-fg/35">{description}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {BUBBLE_PALETTES[kind].map((color) => {
          const selected = value[kind].toLowerCase() === color.value.toLowerCase();
          return (
            <button
              key={color.value}
              type="button"
              onClick={() => onChange({ ...value, [kind]: color.value })}
              style={{ backgroundColor: color.value, color: bubbleTextColor(color.value) }}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-105',
                selected ? 'border-fg ring-2 ring-fg/15' : 'border-white/60 dark:border-white/25',
              )}
              title={color.name}
              aria-label={`${title}: ${color.name}`}
              aria-pressed={selected}
            >
              {selected && <Check size={13} strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BubbleColorPicker({ value, onChange, onReset, saving }: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line/70 bg-fg/[.02] p-3 dark:bg-white/[.03]">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-fg/35">Vista previa</p>
        <div className="mt-2 space-y-2">
          <div className="flex justify-end">
            <span
              style={bubbleStyle('mine', value)}
              className="bubble-me relative inline-block max-w-[78%] px-2.5 py-1 text-[11.5px]"
            >
              Así se verá tu mensaje
            </span>
          </div>
          <div className="flex justify-start">
            <span
              style={bubbleStyle('other', value)}
              className="bubble-other relative inline-block max-w-[78%] px-2.5 py-1 text-[11.5px]"
            >
              Así se verá el mensaje recibido
            </span>
          </div>
        </div>
      </div>

      <ColorRow
        title="Tus mensajes"
        description="Color de las burbujas que envías."
        kind="mine"
        value={value}
        onChange={onChange}
      />
      <ColorRow
        title="Mensajes recibidos"
        description="Color de las burbujas de las otras personas."
        kind="other"
        value={value}
        onChange={onChange}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
        <p className="text-[10px] text-fg/35">
          {saving ? 'Guardando en tu cuenta…' : 'Los cambios se aplican al instante y se guardan en tu cuenta.'}
        </p>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[10.5px] text-fg/55 transition-colors hover:bg-fg/[.05] hover:text-fg"
        >
          <RotateCcw size={11} /> Restaurar predeterminados
        </button>
      </div>
    </div>
  );
}
