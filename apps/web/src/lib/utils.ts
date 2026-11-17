import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function initials(name?: string | null) {
  if (!name) return 'ET';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('');
}

export function formatDate(value?: string | null, opts?: Intl.DateTimeFormatOptions) {
  if (!value) return '—';
  const date = new Date(value.includes('T') || value.includes('Z') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', opts ?? { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function timeAgo(value?: string | null) {
  if (!value) return '';
  const date = new Date(value.includes('T') || value.includes('Z') ? value : value.replace(' ', 'T') + 'Z');
  const diff = Date.now() - date.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;
  return formatDate(value, { day: '2-digit', month: 'short' });
}

export function formatBytes(bytes?: number) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export const statusLabel: Record<string, string> = {
  vigente: 'Vigente',
  modificado: 'Modificado',
  parcialmente_derogado: 'Parcialmente derogado',
  derogado: 'Derogado',
  por_verificar: 'Por verificar',
};

export const typeLabel: Record<string, string> = {
  constitucion: 'Constitución',
  codigo: 'Código',
  ley: 'Ley',
  decreto_legislativo: 'Decreto Legislativo',
  decreto_supremo: 'Decreto Supremo',
  resolucion: 'Resolución',
  reglamento: 'Reglamento',
  tratado: 'Tratado',
};

export const updateTypeLabel: Record<string, string> = {
  modificacion: 'Modificación',
  incorporacion: 'Incorporación',
  derogacion: 'Derogación',
  nueva_norma: 'Nueva norma',
  jurisprudencia: 'Jurisprudencia',
  precedente: 'Precedente',
};

export function avatarUrl(url?: string | null) {
  return url || null;
}
