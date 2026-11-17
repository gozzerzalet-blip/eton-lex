import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, GraduationCap, Search, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export type AcademicSelection = {
  university: string;
  universityId: string;
  campusId: string;
  universityType: 'publica' | 'privada' | '';
  faculty: string;
  career: string;
  cycle: string;
  missingUniversity: string;
};

export const emptyAcademicSelection: AcademicSelection = {
  university: '', universityId: '', campusId: '', universityType: '', faculty: '', career: '', cycle: '', missingUniversity: '',
};

type UniversitySummary = {
  id: string; name: string; type: 'publica' | 'privada';
  licenseStatus: string; licenseStatusRaw: string;
  department: string | null; province: string | null; district: string | null;
  campusCount: number; programCount: number;
};

type Detail = {
  university: UniversitySummary;
  campuses: Array<{ id: string; name: string; department: string | null; province: string | null }>;
  programs: Array<{ id: string; campusId: string; name: string; level: string | null; area: string | null }>;
};

const statusLabel: Record<string, string> = {
  vigente: 'Licencia vigente',
  denegada: 'Licencia denegada',
  cancelada: 'Licencia cancelada',
  expirada: 'Licencia expirada',
  en_proceso: 'En proceso',
  otra: 'Otra situación',
};

export default function UniversityPicker({
  value,
  onChange,
  compact = false,
}: {
  value: AcademicSelection;
  onChange: (value: AcademicSelection) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState(value.university);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UniversitySummary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value.university); }, [value.university]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api<{ universities: UniversitySummary[] }>(
          `/academic/universities?q=${encodeURIComponent(query)}&limit=50`,
        );
        setResults(data.universities);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    if (!value.universityId) { setDetail(null); return; }
    let alive = true;
    api<Detail>(`/academic/universities/${value.universityId}`)
      .then((data) => { if (alive) setDetail(data); })
      .catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [value.universityId]);

  const campuses = detail?.campuses ?? [];
  const programs = useMemo(() => detail?.programs.filter((p) => !value.campusId || p.campusId === value.campusId) ?? [], [detail, value.campusId]);
  const areas = useMemo(() => [...new Set(programs.map((p) => p.area).filter(Boolean) as string[])].sort(), [programs]);
  const careers = useMemo(() => programs.filter((p) => !value.faculty || p.area === value.faculty), [programs, value.faculty]);

  const select = (item: UniversitySummary) => {
    onChange({
      ...emptyAcademicSelection,
      university: item.name,
      universityId: item.id,
      universityType: item.type,
      cycle: value.cycle,
    });
    setQuery(item.name);
    setOpen(false);
    setShowMissing(false);
  };

  return (
    <div className="space-y-3" ref={rootRef}>
      <div className="relative">
        <label className="label">Universidad</label>
        <div className="relative">
          <GraduationCap size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/30" />
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); onChange({ ...value, university: event.target.value, universityId: '', campusId: '', career: '', faculty: '' }); }}
            onFocus={() => setOpen(true)}
            className="input pl-10 pr-9"
            placeholder="Busca por nombre, sede o carrera…"
            autoComplete="off"
          />
          <ChevronDown size={14} className={cn('pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-fg/30 transition-transform', open && 'rotate-180')} />
        </div>

        {open && (
          <div className="glass absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-2xl border border-line p-1.5 shadow-lift">
            <div className="sticky top-0 flex items-center gap-2 bg-[var(--panel-solid)] px-2 py-1.5 text-[10.5px] text-fg/35">
              <Search size={12} /> {loading ? 'Consultando catálogo SUNEDU…' : `${results.length} resultados · fuente oficial SUNEDU`}
            </div>
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => select(item)}
                className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-fg/[.05]"
              >
                <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', item.licenseStatus === 'vigente' ? 'bg-emerald-500' : 'bg-amber-500')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg/85">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-fg/35">
                    {item.type === 'publica' ? 'Pública' : 'Privada'} · {statusLabel[item.licenseStatus] ?? item.licenseStatusRaw}
                    {item.department ? ` · ${item.department}` : ''} · {item.campusCount} sedes
                  </span>
                </span>
                {value.universityId === item.id && <Check size={14} className="mt-1 text-fg/70" />}
              </button>
            ))}
            {!loading && results.length === 0 && (
              <button type="button" onClick={() => { setShowMissing(true); setOpen(false); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-[12px] text-fg/60 hover:bg-fg/[.05]">
                <ShieldAlert size={14} /> Mi universidad no aparece
              </button>
            )}
          </div>
        )}
      </div>

      {value.universityId && detail && (
        <>
          {campuses.length > 0 && (
            <div>
              <label className="label">Sede o filial</label>
              <div className="relative">
                <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
                <select
                  value={value.campusId}
                  onChange={(event) => onChange({ ...value, campusId: event.target.value, faculty: '', career: '' })}
                  className={cn('input appearance-none pl-9', compact && '!py-2 !text-[12px]')}
                >
                  <option value="">Todas las sedes</option>
                  {campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}{campus.province ? ` · ${campus.province}` : ''}</option>)}
                </select>
              </div>
            </div>
          )}

          {areas.length > 0 && (
            <div>
              <label className="label">Facultad / área académica</label>
              <select
                value={value.faculty}
                onChange={(event) => onChange({ ...value, faculty: event.target.value, career: '' })}
                className={cn('input appearance-none', compact && '!py-2 !text-[12px]')}
              >
                <option value="">Selecciona un área</option>
                {areas.slice(0, 200).map((area) => <option key={area} value={area}>{area}</option>)}
              </select>
              <p className="mt-1 text-[9.5px] leading-relaxed text-fg/25">SUNEDU publica áreas académicas, no facultades. Puedes escribir tu facultad en el perfil si lo deseas.</p>
            </div>
          )}

          {careers.length > 0 && (
            <div>
              <label className="label">Carrera profesional</label>
              <select
                value={value.career}
                onChange={(event) => onChange({ ...value, career: event.target.value })}
                className={cn('input appearance-none', compact && '!py-2 !text-[12px]')}
              >
                <option value="">Selecciona una carrera</option>
                {careers.slice(0, 300).map((program) => <option key={program.id} value={program.name}>{program.name}{program.level ? ` · ${program.level}` : ''}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      <button type="button" onClick={() => setShowMissing((current) => !current)} className="text-[11px] text-fg/40 underline decoration-fg/20 underline-offset-4 hover:text-fg/70">
        Mi universidad no aparece
      </button>
      {showMissing && (
        <textarea
          value={value.missingUniversity}
          onChange={(event) => onChange({ ...value, missingUniversity: event.target.value })}
          rows={2}
          maxLength={240}
          placeholder="Escribe el nombre de tu universidad y, si puedes, tu sede. Lo revisaremos con fuente oficial."
          className="input resize-none text-[12px]"
        />
      )}
    </div>
  );
}
