import fs from 'node:fs';
import { Router } from 'express';
import { asyncHandler, badRequest } from '../../lib/http.js';
export const academicRouter = Router();
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/academic-catalog.json', import.meta.url), 'utf8'));
const strip = (value) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
function summary(university) {
    const { campuses, programs, ...rest } = university;
    return { ...rest, campusCount: campuses.length, programCount: programs.length };
}
academicRouter.get('/universities', asyncHandler(async (req, res) => {
    const q = strip(String(req.query.q ?? '').trim());
    const type = String(req.query.type ?? '').trim();
    const status = String(req.query.status ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit ?? 40) || 40, 1), 100);
    let items = catalog.universities;
    if (type === 'publica' || type === 'privada')
        items = items.filter((u) => u.type === type);
    if (status)
        items = items.filter((u) => u.licenseStatus === status);
    if (q) {
        items = items
            .map((u) => ({ u, score: u.nameKey.includes(q) ? 0 : 1 }))
            .filter(({ u }) => u.nameKey.includes(q) || u.programs.some((p) => p.nameKey.includes(q)))
            .sort((a, b) => a.score - b.score || a.u.name.localeCompare(b.u.name, 'es'))
            .map(({ u }) => u);
    }
    res.json({
        source: catalog.source,
        generatedAt: catalog.generatedAt,
        note: catalog.note,
        total: items.length,
        universities: items.slice(0, limit).map(summary),
    });
}));
academicRouter.get('/universities/:id', asyncHandler(async (req, res) => {
    const university = catalog.universities.find((u) => u.id === req.params.id);
    if (!university)
        throw badRequest('Universidad no encontrada en el catálogo oficial.');
    const campusId = String(req.query.campusId ?? '').trim();
    const q = strip(String(req.query.q ?? '').trim());
    const programs = university.programs.filter((p) => (!campusId || p.campusId === campusId) && (!q || p.nameKey.includes(q) || strip(p.area ?? '').includes(q)));
    res.json({
        source: catalog.source,
        university: summary(university),
        campuses: university.campuses,
        programs: programs.slice(0, 500),
        totalPrograms: programs.length,
    });
}));
//# sourceMappingURL=academic.routes.js.map