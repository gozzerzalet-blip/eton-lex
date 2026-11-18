import { completeChat, streamChatWith } from './providers.js';
import { route } from './router.js';
const REASONING_SYSTEM = `
ACTIVIDAD INTERNA — NO LA MUESTRES AL USUARIO.
Antes de redactar, analiza las fuentes como un abogado investigador:
1. Separa cada afirmación de las fuentes y anota con qué [F#] cuenta.
2. Identifica quién actúa, en qué supuesto y qué consecuencia jurídica produce.
3. Detecta contradicciones entre fuentes, datos que faltan y referencias no verificadas.
4. Formula un esquema de respuesta: idea central, matices y conclusiones prudentes.
Devuelve solo ese análisis breve en español. No redactes la respuesta final.
`;
/**
 *Combina razonamiento y claridad. Solo ejecuta dos pasos cuando el router tiene
 *un modelo de razonamiento realmente distinto; si no, hace una sola pasada y lo
 *informa. Así nunca se finge una síntesis de dos modelos.
 */
export async function synthesize(opts) {
    const reasoning = route('reasoning');
    const clarity = route('clarity');
    const roles = [];
    const usage = [];
    const record = (role, info) => {
        usage.push({ role, info });
        opts.onUsage?.(role, info);
    };
    let messages = opts.messages;
    if (reasoning.distinct) {
        opts.onStage?.('reasoning', 'Analizando las fuentes y contrastando la información…');
        const analysisMessages = opts.messages.map((m) => m.role === 'system'
            ? { role: 'system', content: `${typeof m.content === 'string' ? m.content : ''}\n\n${REASONING_SYSTEM}` }
            : m);
        const analysis = await completeChat(reasoning.target, analysisMessages, opts.signal);
        roles.push('reasoning');
        if (analysis.usage)
            record('reasoning', analysis.usage);
        const anchor = `ANÁLISIS INTERNO REALIZADO POR EL MODELO DE RAZONAMIENTO (úsalo para ordenar tu respuesta; no lo transcribas ni lo presentes como fuente):\n${analysis.text.slice(0, 6000)}`;
        messages = opts.messages.map((m) => m.role === 'system'
            ? { role: 'system', content: `${typeof m.content === 'string' ? m.content : ''}\n\n${anchor}` }
            : m);
    }
    opts.onStage?.('clarifying', 'Redactando la explicación con lenguaje sencillo…');
    let text = '';
    for await (const delta of streamChatWith(clarity.target, messages, opts.signal, (info) => record('clarity', info))) {
        text += delta;
        opts.emitDelta?.(delta);
    }
    roles.push('clarity');
    return { text, roles, usage };
}
//# sourceMappingURL=synthesizer.js.map