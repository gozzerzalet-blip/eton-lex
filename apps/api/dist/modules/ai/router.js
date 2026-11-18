import { config } from '../../config.js';
function primaryTarget() {
    return {
        provider: config.ai.provider,
        model: config.ai.model,
        baseUrl: config.ai.baseUrl,
        apiKey: config.ai.apiKey,
    };
}
function isDistinct(target, main) {
    return target.provider !== main.provider || target.model !== main.model || Boolean(target.baseUrl);
}
/**
 * Elige el modelo para una capacidad. Si el rol no está configurado, usa el
 * modelo principal y lo declara: nunca se inventa un segundo modelo.
 */
export function route(role) {
    const main = primaryTarget();
    const roleCfg = role === 'primary' ? null : config.ai.roles[role];
    if (!roleCfg?.configured) {
        return {
            role,
            target: main,
            label: `${main.provider}/${main.model || 'sin modelo'}`,
            distinct: false,
        };
    }
    const target = {
        provider: roleCfg.provider,
        model: roleCfg.model,
        baseUrl: roleCfg.baseUrl,
        apiKey: roleCfg.apiKey || config.ai.apiKey,
    };
    return {
        role,
        target,
        label: `${target.provider}/${target.model}`,
        distinct: isDistinct(target, main),
    };
}
/** Información honesta para /api/ai/status y para la interfaz. */
export function routerStatus() {
    const roles = ['reasoning', 'clarity', 'vision'].map((r) => {
        const choice = route(r);
        return {
            role: r,
            configured: choice.distinct,
            provider: choice.target.provider,
            model: choice.target.model || null,
            source: choice.distinct ? 'role' : 'primary',
        };
    });
    return {
        mode: roles.some((r) => r.configured) ? 'hybrid' : 'single-model',
        roles,
        note: roles.some((r) => r.configured)
            ? 'Los roles configurados usan proveedores/modelos distintos del principal.'
            : 'Sin modelos por rol configurados: todas las capacidades usan el modelo principal.',
    };
}
//# sourceMappingURL=router.js.map