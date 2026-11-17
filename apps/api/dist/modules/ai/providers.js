import { config } from '../../config.js';
import { ApiError } from '../../lib/http.js';
export function providerInfo() {
    return {
        configured: config.ai.configured,
        provider: config.ai.provider,
        model: config.ai.model || null,
        embeddings: Boolean(config.ai.embeddingModel && config.ai.configured),
        fallback: config.ai.fallback.configured
            ? { provider: config.ai.fallback.provider, model: config.ai.fallback.model || null, active: true }
            : null,
    };
}
function primary() {
    return {
        provider: config.ai.provider,
        model: config.ai.model,
        baseUrl: config.ai.baseUrl,
        apiKey: config.ai.apiKey,
    };
}
function fallback() {
    return {
        provider: config.ai.fallback.provider,
        model: config.ai.fallback.model,
        baseUrl: config.ai.fallback.baseUrl,
        apiKey: config.ai.fallback.apiKey,
    };
}
function baseUrl(t) {
    if (t.baseUrl)
        return t.baseUrl.replace(/\/$/, '');
    switch (t.provider) {
        case 'openrouter':
            return 'https://openrouter.ai/api/v1';
        case 'ollama':
            return 'http://localhost:11434/v1';
        case 'pollinations':
            // Punto de acceso comunitario compatible con OpenAI y sin clave.
            return 'https://text.pollinations.ai';
        case 'openai':
        default:
            return 'https://api.openai.com/v1';
    }
}
/** Ruta de chat completions según el proveedor. */
function chatEndpoint(t) {
    const base = baseUrl(t);
    if (t.provider === 'pollinations')
        return base.endsWith('/openai') ? base : `${base}/openai`;
    return `${base}/chat/completions`;
}
/** Los modelos locales no tienen límite de tiempo; la nube se corta a los 2 min. */
function withTimeout(signal, providerName) {
    if (providerName === 'ollama')
        return signal;
    const limit = AbortSignal.timeout(120_000);
    return signal ? AbortSignal.any([signal, limit]) : limit;
}
const textOf = (content) => typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
async function* sseLines(res) {
    if (!res.body)
        throw new ApiError(502, 'AI_STREAM', 'El proveedor no devolvió un flujo de respuesta.');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const evt of events) {
            for (const line of evt.split(/\r?\n/)) {
                if (line.startsWith('data:')) {
                    const data = line.slice(5).trim();
                    if (data && data !== '[DONE]')
                        yield data;
                }
            }
        }
    }
}
async function readError(res, provider) {
    let detail = '';
    try {
        const raw = await res.text();
        const parsed = JSON.parse(raw);
        detail = parsed.error?.message ?? raw.slice(0, 300);
    }
    catch {
        /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
        throw new ApiError(502, 'AI_AUTH', `El proveedor de IA rechazó la clave configurada (${provider}).`);
    }
    if (res.status === 429) {
        throw new ApiError(429, 'AI_RATE_LIMIT', 'El proveedor de IA alcanzó su límite de uso. Intenta en unos minutos.');
    }
    throw new ApiError(502, 'AI_PROVIDER', `Error del proveedor de IA (${provider} ${res.status}): ${detail || 'sin detalle'}`);
}
function assertConfigured() {
    if (!config.ai.configured) {
        throw new ApiError(503, 'AI_NOT_CONFIGURED', 'ETON AI no está conectada. Configura AI_PROVIDER y AI_MODEL (con AI_API_KEY si el proveedor la exige) en el archivo .env del servidor para activar el asistente. La plataforma no simula respuestas de IA.');
    }
    if (!config.ai.model) {
        throw new ApiError(503, 'AI_MODEL_MISSING', 'Falta AI_MODEL en la configuración del servidor.');
    }
}
export async function* streamChat(messages, signal) {
    assertConfigured();
    const main = primary();
    let emitted = false;
    try {
        for await (const delta of streamWith(main, messages, signal)) {
            emitted = true;
            yield delta;
        }
    }
    catch (err) {
        // Solo se cambia de proveedor si todavía no se mostró texto: así nunca se
        // mezclan dos respuestas ni se duplica lo ya enviado al usuario.
        if (emitted || signal?.aborted || !config.ai.fallback.configured)
            throw err;
        console.warn(`[ai] proveedor ${main.provider} falló (${err.message}); se usa el respaldo ${config.ai.fallback.provider}.`);
        for await (const delta of streamWith(fallback(), messages, signal))
            yield delta;
    }
}
async function* streamWith(t, messages, signal) {
    if (t.provider === 'anthropic') {
        yield* streamAnthropic(t, messages, signal);
        return;
    }
    if (t.provider === 'google') {
        yield* streamGoogle(t, messages, signal);
        return;
    }
    yield* streamOpenAI(t, messages, signal);
}
async function* streamOpenAI(t, messages, signal) {
    const body = {
        model: t.model,
        stream: true,
        temperature: config.ai.temperature,
        max_tokens: config.ai.maxTokens,
        messages: messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string'
                ? m.content
                : m.content.map((p) => p.type === 'text'
                    ? { type: 'text', text: p.text }
                    : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.dataBase64}` } }),
        })),
    };
    const res = await fetch(chatEndpoint(t), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(t.apiKey ? { authorization: `Bearer ${t.apiKey}` } : {}),
            ...(t.provider === 'openrouter' ? { 'HTTP-Referer': config.webOrigin[0], 'X-Title': 'ETON LEX' } : {}),
        },
        body: JSON.stringify(body),
        signal: withTimeout(signal, t.provider),
    });
    if (!res.ok)
        await readError(res, t.provider);
    for await (const data of sseLines(res)) {
        try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta)
                yield delta;
        }
        catch {
            /* fragmento incompleto: se ignora */
        }
    }
}
async function* streamAnthropic(t, messages, signal) {
    const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    const body = {
        model: t.model,
        max_tokens: config.ai.maxTokens,
        temperature: config.ai.temperature,
        system,
        stream: true,
        messages: rest.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: typeof m.content === 'string'
                ? m.content
                : m.content.map((p) => p.type === 'text'
                    ? { type: 'text', text: p.text }
                    : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.dataBase64 } }),
        })),
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': t.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: withTimeout(signal, t.provider),
    });
    if (!res.ok)
        await readError(res, 'anthropic');
    for await (const data of sseLines(res)) {
        try {
            const json = JSON.parse(data);
            if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
                yield json.delta.text;
            }
        }
        catch {
            /* ignore */
        }
    }
}
async function* streamGoogle(t, messages, signal) {
    const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
    const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: typeof m.content === 'string'
            ? [{ text: m.content }]
            : m.content.map((p) => p.type === 'text'
                ? { text: p.text }
                : { inline_data: { mime_type: p.mime, data: p.dataBase64 } }),
    }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(t.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(t.apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            contents,
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { temperature: config.ai.temperature, maxOutputTokens: config.ai.maxTokens },
        }),
        signal: withTimeout(signal, t.provider),
    });
    if (!res.ok)
        await readError(res, 'google');
    for await (const data of sseLines(res)) {
        try {
            const json = JSON.parse(data);
            const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
            if (text)
                yield text;
        }
        catch {
            /* ignore */
        }
    }
}
export async function embedTexts(texts) {
    if (!config.ai.embeddingModel || !config.ai.configured || texts.length === 0)
        return null;
    const provider = config.ai.provider;
    if (provider === 'google') {
        const out = [];
        for (const text of texts) {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.embeddingModel)}:embedContent?key=${encodeURIComponent(config.ai.apiKey)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: `models/${config.ai.embeddingModel}`, content: { parts: [{ text }] } }),
            });
            if (!res.ok)
                await readError(res, 'google-embeddings');
            const json = (await res.json());
            if (json.embedding?.values)
                out.push(json.embedding.values);
        }
        return out;
    }
    const res = await fetch(`${baseUrl({ provider, model: config.ai.model, baseUrl: config.ai.baseUrl, apiKey: config.ai.apiKey })}/embeddings`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(config.ai.apiKey ? { authorization: `Bearer ${config.ai.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.ai.embeddingModel, input: texts }),
    });
    if (!res.ok)
        await readError(res, `${provider}-embeddings`);
    const json = (await res.json());
    return json.data?.map((d) => d.embedding) ?? null;
}
//# sourceMappingURL=providers.js.map