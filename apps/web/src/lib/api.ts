let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

type Options = { noRetry?: boolean; raw?: boolean };

async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!res.ok) return false;
        const data = await res.json();
        accessToken = data.accessToken as string;
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => { refreshing = null; }, 50);
      }
    })();
  }
  return refreshing;
}

export async function refreshSession(): Promise<{ accessToken: string; user: unknown } | null> {
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    accessToken = data.accessToken as string;
    return data;
  } catch {
    return null;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}, opts: Options = {}): Promise<T> {
  const run = () => {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
    return fetch(`/api${path}`, { credentials: 'include', ...init, headers });
  };

  let res = await run();
  if (res.status === 401 && !opts.noRetry) {
    const ok = await refresh();
    if (ok) res = await run();
  }

  if (opts.raw) {
    if (!res.ok) throw new ApiClientError(res.status, 'HTTP', 'Error de red');
    return res as unknown as T;
  }

  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Ocurrió un error inesperado.', err?.details);
  }
  return data as T;
}

export type StreamHandlers = {
  onMeta?: (payload: {
    userMessageId: string;
    mode: string;
    citations: unknown[];
    retrieval: Array<{ kind: string; label: string }>;
    libraryMode?: boolean;
    plan?: { kind: string; label: string; reason: string; usesLibrary: boolean; usesWeb: boolean };
    web?: { status: string; enabled?: boolean; results?: number; errors?: string[]; tookMs?: number };
  }) => void;
  onStatus?: (payload: { stage: string; message: string }) => void;
  onDelta?: (text: string) => void;
  onDone?: (payload: { id: string; content: string; citations: unknown[]; latencyMs: number }) => void;
  onError?: (message: string) => void;
};

export async function streamAiMessage(
  conversationId: string,
  body: { content?: string; mode?: string; attachmentIds?: string[] },
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  const res = await fetch(`/api/ai/conversations/${conversationId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const message = data?.error?.message ?? 'No se pudo conectar con ETON AI.';
    handlers.onError?.(message);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) { handlers.onError?.('El navegador no soporta streaming.'); return; }
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? '';
    for (const evt of events) {
      let event = 'message';
      let data = '';
      for (const line of evt.split(/\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        if (event === 'meta') handlers.onMeta?.(payload);
        else if (event === 'status') handlers.onStatus?.(payload);
        else if (event === 'delta') handlers.onDelta?.(payload.text);
        else if (event === 'done') handlers.onDone?.(payload);
        else if (event === 'error') handlers.onError?.(payload.message);
      } catch {
        /* fragmento inválido */
      }
    }
  }
}
