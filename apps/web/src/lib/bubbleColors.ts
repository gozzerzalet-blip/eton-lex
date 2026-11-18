import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { api, ApiClientError } from './api';
import { useAuth } from './store';
import type { User } from './types';

export type BubbleColors = { mine: string; other: string };

/** Paleta extensa: tonos vivos y pastel, todos legibles con texto automático. */
export const BUBBLE_PALETTES: Record<keyof BubbleColors, Array<{ name: string; value: string }>> = {
  mine: [
    { name: 'Azul ETON', value: '#0B84FF' },
    { name: 'Azul profundo', value: '#1E40AF' },
    { name: 'Azul cobalto', value: '#2563EB' },
    { name: 'Azul cielo', value: '#38BDF8' },
    { name: 'Turquesa', value: '#0E7490' },
    { name: 'Verde esmeralda', value: '#167C5A' },
    { name: 'Verde bosque', value: '#166534' },
    { name: 'Verde azulado', value: '#0F766E' },
    { name: 'Violeta', value: '#6D4AFF' },
    { name: 'Morado', value: '#7C3AED' },
    { name: 'Magenta', value: '#A21CAF' },
    { name: 'Granate', value: '#9B2C4F' },
    { name: 'Rojo', value: '#B91C1C' },
    { name: 'Naranja', value: '#C2410C' },
    { name: 'Ámbar', value: '#B45309' },
    { name: 'Pizarra', value: '#243447' },
    { name: 'Grafito', value: '#4B5560' },
    { name: 'Tinta', value: '#111214' },
    { name: 'Azul pastel', value: '#A9C7F5' },
    { name: 'Celeste pastel', value: '#BFE3F7' },
    { name: 'Rosa pastel', value: '#F3BFCB' },
    { name: 'Menta pastel', value: '#BFE6D3' },
    { name: 'Lavanda pastel', value: '#D5C9F2' },
    { name: 'Durazno pastel', value: '#F4D3B8' },
    { name: 'Amarillo pastel', value: '#F7E7A6' },
  ],
  other: [
    { name: 'Gris perla', value: '#E9E9EC' },
    { name: 'Gris humo', value: '#D6D6DC' },
    { name: 'Gris piedra', value: '#C9CDD2' },
    { name: 'Gris azulado', value: '#BFC7D1' },
    { name: 'Gris claro', value: '#AEB6BF' },
    { name: 'Azul hielo', value: '#DCEBFF' },
    { name: 'Azul cielo claro', value: '#CFE8FF' },
    { name: 'Celeste grisáceo', value: '#D7E2E8' },
    { name: 'Verde menta', value: '#D9F2E6' },
    { name: 'Verde salvia', value: '#D3DDCF' },
    { name: 'Verde lima claro', value: '#E3F2C1' },
    { name: 'Turquesa pastel', value: '#CDEDE6' },
    { name: 'Lavanda', value: '#E8E2FF' },
    { name: 'Violeta claro', value: '#E4D9FF' },
    { name: 'Lila niebla', value: '#EDE7F6' },
    { name: 'Rosa pálido', value: '#F6DDE4' },
    { name: 'Rosa melocotón', value: '#FADDD2' },
    { name: 'Coral claro', value: '#F2C7C7' },
    { name: 'Arena', value: '#F1E9D8' },
    { name: 'Marfil', value: '#F4F1EA' },
    { name: 'Crema', value: '#FBF3E4' },
    { name: 'Durazno pastel', value: '#F4D3B8' },
    { name: 'Amarillo pastel', value: '#F7E7A6' },
    { name: 'Blanco humo', value: '#F7F7F9' },
    { name: 'Gris grafito claro', value: '#B8BFC7' },
  ],
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DARK_TEXT = '#111214';
const LIGHT_TEXT = '#FFFFFF';

export function defaultBubbleColors(): BubbleColors {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return dark
    ? { mine: '#0B84FF', other: '#2C2C30' }
    : { mine: '#0B84FF', other: '#E9E9EC' };
}

export function normalizeBubbleColors(value?: Partial<BubbleColors> | null): BubbleColors {
  const fallback = defaultBubbleColors();
  return {
    mine: value?.mine && HEX_COLOR.test(value.mine) ? value.mine : fallback.mine,
    other: value?.other && HEX_COLOR.test(value.other) ? value.other : fallback.other,
  };
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const component = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Elige texto claro u oscuro para que cualquier color siga siendo legible. */
export function bubbleTextColor(hex: string) {
  return relativeLuminance(hex) > 0.42 ? DARK_TEXT : LIGHT_TEXT;
}

export function bubbleStyle(kind: keyof BubbleColors, colors: BubbleColors): CSSProperties {
  const background = colors[kind];
  return { backgroundColor: background, color: bubbleTextColor(background) };
}

/** Estado compartido: aplica al instante y guarda la preferencia en la cuenta. */
export function useBubbleColors() {
  const { user, setUser } = useAuth();
  const [colors, setColors] = useState<BubbleColors>(() => normalizeBubbleColors(user?.bubbleColors));
  const [saving, setSaving] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    setColors(normalizeBubbleColors(user?.bubbleColors));
  }, [user?.bubbleColors]);

  const update = useCallback(async (next: BubbleColors) => {
    const normalized = normalizeBubbleColors(next);
    setColors(normalized);
    const requestId = ++latestRequest.current;
    setSaving(true);
    try {
      const response = await api<{ user: User }>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ bubbleColors: normalized }),
      });
      if (requestId === latestRequest.current) setUser(response.user);
    } catch (error) {
      if (requestId === latestRequest.current) {
        toast.error(error instanceof ApiClientError ? error.message : 'No se pudieron guardar los colores de las burbujas.');
      }
    } finally {
      if (requestId === latestRequest.current) setSaving(false);
    }
  }, [setUser]);

  const reset = useCallback(() => update(defaultBubbleColors()), [update]);

  return { colors, update, reset, saving };
}
