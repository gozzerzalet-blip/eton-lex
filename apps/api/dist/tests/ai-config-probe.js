/** Imprime la configuración efectiva de IA para las pruebas de arranque. */
import { config } from '../config.js';
console.log(JSON.stringify({
    provider: config.ai.provider,
    model: config.ai.model,
    configured: config.ai.configured,
    fallbackProvider: config.ai.fallback.provider,
    fallbackConfigured: config.ai.fallback.configured,
}));
//# sourceMappingURL=ai-config-probe.js.map