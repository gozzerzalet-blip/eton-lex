import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowUpRight, Circle, Eraser, MousePointer2, Paintbrush, Plus, Square, Type,
} from 'lucide-react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { cn } from '../lib/utils';

type Point = { x: number; y: number };
type ElementData = Record<string, unknown>;
type BoardElement = {
  id: string;
  pageId: string;
  authorId?: string;
  authorName?: string;
  type: string;
  data: string | ElementData;
};
type BoardPage = { id: string; page_number: number; title: string };
type Tool = 'pen' | 'rect' | 'ellipse' | 'arrow' | 'eraser' | 'text';
type Draft = { authorId?: string; type: string; data: ElementData; pageId: string };
type Stroke = { type: 'path' | 'rect' | 'ellipse' | 'arrow'; start: Point; current: Point; points: Point[] };

const TOOLS: Array<{ id: Tool; label: string; icon: typeof Paintbrush }> = [
  { id: 'pen', label: 'Lápiz', icon: Paintbrush },
  { id: 'rect', label: 'Rectángulo', icon: Square },
  { id: 'ellipse', label: 'Elipse', icon: Circle },
  { id: 'arrow', label: 'Flecha', icon: ArrowUpRight },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'eraser', label: 'Borrador', icon: Eraser },
];

function parseData(data: string | ElementData): ElementData {
  if (typeof data !== 'string') return data;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? (parsed as ElementData) : {};
  } catch {
    return {};
  }
}

function boundsOf(element: { type: string; data: string | ElementData }) {
  const data = parseData(element.data);
  const num = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (element.type === 'path') {
    const points = Array.isArray(data.points) ? data.points as Point[] : [];
    if (!points.length) return null;
    const xs = points.map((p) => num(p?.x));
    const ys = points.map((p) => num(p?.y));
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (element.type === 'text') {
    const x = num(data.x); const y = num(data.y);
    return { x, y: y - 0.04, w: Math.min(0.5, String(data.text ?? '').length * 0.012), h: 0.05 };
  }
  const x = num(data.x); const y = num(data.y);
  if (element.type === 'arrow') {
    const x2 = num(data.x2); const y2 = num(data.y2);
    return { x: Math.min(x, x2), y: Math.min(y, y2), w: Math.abs(x2 - x), h: Math.abs(y2 - y) };
  }
  return { x, y, w: num(data.w), h: num(data.h) };
}

function drawElement(ctx: CanvasRenderingContext2D, element: { type: string; data: string | ElementData }, w: number, h: number) {
  const data = parseData(element.data);
  const color = typeof data.color === 'string' ? data.color : '#1c1c1f';
  const width = typeof data.width === 'number' ? data.width : 2.5;
  const num = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (element.type === 'path') {
    const points = (Array.isArray(data.points) ? data.points : []) as Point[];
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(num(points[0].x) * w, num(points[0].y) * h, Math.max(1, width / 2), 0, Math.PI * 2);
      ctx.fill();
    } else if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(num(points[0].x) * w, num(points[0].y) * h);
      for (let i = 1; i < points.length; i++) ctx.lineTo(num(points[i].x) * w, num(points[i].y) * h);
      ctx.stroke();
    }
  } else if (element.type === 'rect') {
    const x = num(data.x) * w; const y = num(data.y) * h;
    ctx.strokeRect(x, y, num(data.w) * w, num(data.h) * h);
  } else if (element.type === 'ellipse') {
    const cx = (num(data.x) + num(data.w) / 2) * w;
    const cy = (num(data.y) + num(data.h) / 2) * h;
    const rx = Math.abs(num(data.w) * w) / 2;
    const ry = Math.abs(num(data.h) * h) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (element.type === 'arrow') {
    const x1 = num(data.x) * w; const y1 = num(data.y) * h;
    const x2 = num(data.x2) * w; const y2 = num(data.y2) * h;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(9, width * 4);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (element.type === 'text') {
    const size = num(data.size, 16);
    ctx.font = `500 ${size}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(String(data.text ?? ''), num(data.x) * w, num(data.y) * h);
  }
  ctx.restore();
}

function strokeToData(stroke: Stroke, color: string, width: number): ElementData {
  if (stroke.type === 'path') return { points: stroke.points, color, width };
  if (stroke.type === 'arrow') return { x: stroke.start.x, y: stroke.start.y, x2: stroke.current.x, y2: stroke.current.y, color, width };
  return {
    x: Math.min(stroke.start.x, stroke.current.x),
    y: Math.min(stroke.start.y, stroke.current.y),
    w: Math.abs(stroke.current.x - stroke.start.x),
    h: Math.abs(stroke.current.y - stroke.start.y),
    color,
    width,
  };
}

export default function Whiteboard({ roomId, initialPages, initialElements, userId }: {
  roomId: string;
  initialPages: BoardPage[];
  initialElements: BoardElement[];
  userId: string;
}) {
  const socket = getSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const lastEmitRef = useRef(0);
  const activePageRef = useRef<string | null>(initialPages[0]?.id ?? null);

  const [pages, setPages] = useState<BoardPage[]>(initialPages);
  const [elements, setElements] = useState<BoardElement[]>(initialElements);
  const [activePageId, setActivePageId] = useState<string | null>(initialPages[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [localDraft, setLocalDraft] = useState<Draft | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1c1c1f');
  const [width, setWidth] = useState(2.5);
  const [addingPage, setAddingPage] = useState(false);

  activePageRef.current = activePageId;

  useEffect(() => {
    setPages(initialPages);
    if (!initialPages.some((page) => page.id === activePageRef.current)) {
      setActivePageId(initialPages[0]?.id ?? null);
    }
  }, [initialPages]);
  useEffect(() => { setElements(initialElements); }, [initialElements]);

  // Lienzo con escala por devicePixelRatio y tamaño adaptativo.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
      setSize({ w: rect.width, h: rect.height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size.w || !size.h) return;
    ctx.clearRect(0, 0, size.w, size.h);
    const pageId = activePageId;
    for (const element of elements) {
      if (element.pageId === pageId) drawElement(ctx, element, size.w, size.h);
    }
    for (const draft of Object.values(drafts)) {
      if (draft.pageId === pageId) drawElement(ctx, { type: draft.type, data: draft.data }, size.w, size.h);
    }
    if (localDraft && localDraft.pageId === pageId) {
      drawElement(ctx, { type: localDraft.type, data: localDraft.data }, size.w, size.h);
    }
  }, [activePageId, drafts, elements, localDraft, size]);

  // Colaboración en tiempo real.
  useEffect(() => {
    if (!socket) return;
    const onElement = (payload: { roomId: string; element?: BoardElement }) => {
      if (payload.roomId !== roomId || !payload.element?.id) return;
      const element = payload.element;
      setElements((current) => current.some((item) => item.id === element.id) ? current : [...current, element]);
      if (element.authorId) {
        setDrafts((current) => {
          if (!current[element.authorId!]) return current;
          const next = { ...current };
          delete next[element.authorId!];
          return next;
        });
      }
    };
    const onDeleted = (payload: { roomId: string; elementId: string }) => {
      if (payload.roomId !== roomId) return;
      setElements((current) => current.filter((element) => element.id !== payload.elementId));
    };
    const onDraft = (payload: { roomId: string; pageId: string; element: Draft }) => {
      if (payload.roomId !== roomId || !payload.element) return;
      const author = payload.element.authorId ?? 'anon';
      setDrafts((current) => ({ ...current, [author]: { ...payload.element, pageId: payload.pageId } }));
    };
    const onPage = (payload: { roomId: string; page: { id: string; page_number: number; title: string } }) => {
      if (payload.roomId !== roomId || !payload.page?.id) return;
      const page = { id: payload.page.id, page_number: payload.page.page_number, title: payload.page.title };
      setPages((current) => current.some((item) => item.id === page.id) ? current : [...current, page]);
      setActivePageId(page.id);
    };
    socket.on('whiteboard:element', onElement);
    socket.on('whiteboard:element-deleted', onDeleted);
    socket.on('whiteboard:draft', onDraft);
    socket.on('whiteboard:page', onPage);
    return () => {
      socket.off('whiteboard:element', onElement);
      socket.off('whiteboard:element-deleted', onDeleted);
      socket.off('whiteboard:draft', onDraft);
      socket.off('whiteboard:page', onPage);
    };
  }, [roomId, socket]);

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const commit = useCallback(async (type: string, data: ElementData) => {
    if (!activePageRef.current) return;
    try {
      const response = await api<{ id: string }>(`/rooms/${roomId}/elements`, {
        method: 'POST',
        body: JSON.stringify({ pageId: activePageRef.current, type, data }),
      });
      setElements((current) => current.some((item) => item.id === response.id)
        ? current
        : [...current, { id: response.id, pageId: activePageRef.current!, authorId: userId, type, data }]);
    } catch {
      // El servidor emitirá el elemento si la petición llegó a procesarse.
    }
  }, [roomId, userId]);

  const eraseAt = useCallback((point: Point) => {
    const candidates = elements.filter((element) => element.pageId === activePageRef.current);
    for (let i = candidates.length - 1; i >= 0; i--) {
      const bounds = boundsOf(candidates[i]);
      if (!bounds) continue;
      const margin = 0.015;
      if (point.x >= bounds.x - margin && point.x <= bounds.x + Math.max(bounds.w, margin) + margin
        && point.y >= bounds.y - margin && point.y <= bounds.y + Math.max(bounds.h, margin) + margin) {
        const id = candidates[i].id;
        setElements((current) => current.filter((element) => element.id !== id));
        void api(`/rooms/${roomId}/elements/${id}`, { method: 'DELETE' }).catch(() => {});
        return;
      }
    }
  }, [elements, roomId]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!activePageId) return;
    const point = pointOf(event);
    if (tool === 'eraser') { eraseAt(point); return; }
    if (tool === 'text') {
      const value = window.prompt('Escribe el texto para la pizarra:');
      if (value?.trim()) {
        void commit('text', { x: point.x, y: point.y, text: value.trim().slice(0, 240), color, size: Math.max(14, width * 6) });
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    strokeRef.current = { type: tool === 'pen' ? 'path' : tool, start: point, current: point, points: [point] };
    setLocalDraft({ authorId: userId, pageId: activePageId, type: tool === 'pen' ? 'path' : tool, data: strokeToData(strokeRef.current as Stroke, color, width) });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || !activePageId) return;
    const point = pointOf(event);
    stroke.current = point;
    if (stroke.type === 'path') {
      const last = stroke.points[stroke.points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 0.004) stroke.points.push(point);
    }
    const data = strokeToData(stroke, color, width);
    setLocalDraft({ authorId: userId, pageId: activePageId, type: stroke.type, data });
    const now = Date.now();
    if (now - lastEmitRef.current > 45) {
      lastEmitRef.current = now;
      socket?.emit('whiteboard:draft', { roomId, pageId: activePageId, element: { authorId: userId, type: stroke.type, data } });
    }
  };

  const onPointerUp = () => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    setLocalDraft(null);
    if (!stroke || !activePageId) return;
    const data = strokeToData(stroke, color, width);
    const trivial = stroke.type !== 'path' && (Math.abs(data.w as number) < 0.01 || Math.abs(data.h as number) < 0.01);
    if (trivial) return;
    void commit(stroke.type, data);
  };

  const addPage = async () => {
    setAddingPage(true);
    try {
      const response = await api<{ page: { id: string; pageNumber: number; title: string } }>(`/rooms/${roomId}/pages`, { method: 'POST' });
      const page = { id: response.page.id, page_number: response.page.pageNumber, title: response.page.title };
      setPages((current) => current.some((item) => item.id === page.id) ? current : [...current, page]);
      setActivePageId(page.id);
    } catch {
      // Se ignora: la página puede haber sido creada por otro participante.
    } finally {
      setAddingPage(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/70 px-3 py-2">
        <div className="flex flex-wrap items-center gap-0.5 rounded-full border border-line bg-white/50 p-0.5 dark:bg-white/[.05]">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTool(item.id)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                tool === item.id ? 'bg-fg text-paper' : 'text-fg/45 hover:bg-fg/[.07] hover:text-fg',
              )}
              title={item.label}
              aria-label={item.label}
            >
              <item.icon size={14} />
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 rounded-full border border-line px-2 py-1" title="Color del trazo">
          <span className="h-3.5 w-3.5 rounded-full border border-fg/10" style={{ backgroundColor: color }} />
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-4 w-5 cursor-pointer bg-transparent" aria-label="Color del trazo" />
        </label>
        <label className="flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[10px] text-fg/45" title="Grosor del trazo">
          <MousePointer2 size={12} />
          <input type="range" min={1} max={12} step={0.5} value={width} onChange={(event) => setWidth(Number(event.target.value))} className="h-3 w-16 accent-current" aria-label="Grosor del trazo" />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <select
            value={activePageId ?? ''}
            onChange={(event) => setActivePageId(event.target.value || null)}
            className="input !w-auto !py-1 !text-[11px]"
            aria-label="Página de la pizarra"
          >
            {pages.map((page) => <option key={page.id} value={page.id}>{page.title || `Página ${page.page_number}`}</option>)}
          </select>
          <button onClick={() => { void addPage(); }} disabled={addingPage} className="btn btn-sm !px-2" title="Añadir página" aria-label="Añadir página">
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-[300px] flex-1 overflow-hidden rounded-b-2xl bg-[radial-gradient(circle_at_1px_1px,rgba(10,10,10,.10)_1px,transparent_0)] bg-[length:22px_22px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,.09)_1px,transparent_0)]">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn('absolute inset-0 touch-none', tool === 'eraser' ? 'cursor-cell' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
        />
        {!pages.length && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-fg/30">Preparando la pizarra…</p>
        )}
      </div>
    </div>
  );
}
