import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { ApiError } from './http.js';
const ALLOWED = new Map([
    ['application/pdf', '.pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ['application/msword', '.doc'],
    ['text/plain', '.txt'],
    ['text/markdown', '.md'],
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['audio/webm', '.webm'],
    ['audio/ogg', '.ogg'],
    ['audio/mpeg', '.mp3'],
    ['audio/mp4', '.m4a'],
    ['audio/wav', '.wav'],
]);
export function storageFor(subdir) {
    const dir = path.join(config.paths.uploads, subdir);
    fs.mkdirSync(dir, { recursive: true });
    return multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, dir),
        filename: (_req, file, cb) => {
            const ext = ALLOWED.get(file.mimetype) ?? path.extname(file.originalname) ?? '.bin';
            cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
        },
    });
}
export function uploader(subdir) {
    return multer({
        storage: storageFor(subdir),
        limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 5 },
        fileFilter: (_req, file, cb) => {
            if (!ALLOWED.has(file.mimetype)) {
                cb(new ApiError(415, 'UNSUPPORTED_TYPE', `Tipo de archivo no permitido: ${file.mimetype}`));
                return;
            }
            cb(null, true);
        },
    });
}
export async function extractText(filePath, mime) {
    try {
        if (mime === 'application/pdf') {
            const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
            const data = await pdfParse(fs.readFileSync(filePath));
            return data.text?.trim() || null;
        }
        if (mime.includes('wordprocessingml') || mime === 'application/msword') {
            const mammoth = (await import('mammoth')).default;
            const result = await mammoth.extractRawText({ path: filePath });
            return result.value?.trim() || null;
        }
        if (mime.startsWith('text/')) {
            return fs.readFileSync(filePath, 'utf8').slice(0, 500_000);
        }
    }
    catch (err) {
        console.warn('[files] no se pudo extraer texto:', err.message);
    }
    return null;
}
const SECTION_RE = /^(?:CAP[IÍ]TULO|T[IÍ]TULO|SECCI[OÓ]N|SUBSECCI[OÓ]N|ART[IÍ]CULO|ANEXO|AP[IÉ]NDICE|PARTE|LIBRO)\b.{0,120}$/i;
async function rawExtract(filePath, mime) {
    if (mime === 'application/pdf') {
        const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
        const data = await pdfParse(fs.readFileSync(filePath));
        const text = data.text?.trim();
        return text ? { text, pages: data.numpages ?? null } : null;
    }
    if (mime.includes('wordprocessingml') || mime === 'application/msword') {
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.extractRawText({ path: filePath });
        const text = result.value?.trim();
        // DOCX no tiene paginación fija: no se inventa un número de página.
        return text ? { text, pages: null } : null;
    }
    if (mime.startsWith('text/')) {
        return { text: fs.readFileSync(filePath, 'utf8').slice(0, 500_000), pages: null };
    }
    return null;
}
function detectSections(text) {
    const sections = [];
    let offset = 0;
    for (const line of text.split('\n')) {
        const title = line.trim();
        if (title.length >= 4 && title.length <= 140 && SECTION_RE.test(title)) {
            sections.push({ offset, title });
            if (sections.length >= 300)
                break;
        }
        offset += line.length + 1;
    }
    return sections;
}
/**
 * Extrae texto conservando los marcadores de página y detectando encabezados
 * de sección. Nunca inventa páginas: si el formato no las delimita, `pages` es
 * null y los fragmentos se entregan sin número de página.
 */
export async function extractDocument(filePath, mime) {
    const raw = await rawExtract(filePath, mime);
    if (!raw || !raw.text.trim())
        return null;
    // `\f` (form feed) es el separador de página que emiten pdf-parse y la
    // mayoría de las cadenas de OCR. Se normaliza a salto de línea sin perder
    // la posición exacta de cada inicio de página.
    const parts = raw.text.split('\f');
    const pageStarts = [];
    let text = '';
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
            text += '\n';
            pageStarts.push(text.length);
        }
        text += parts[i];
    }
    return {
        text,
        pages: raw.pages ?? (pageStarts.length > 0 ? pageStarts.length + 1 : null),
        pageStarts,
        sections: detectSections(text),
    };
}
function pageAt(doc, offset) {
    if (doc.pageStarts.length === 0)
        return null;
    let page = 1;
    for (const start of doc.pageStarts) {
        if (start <= offset)
            page += 1;
        else
            break;
    }
    return page;
}
function sectionAt(doc, offset) {
    let title = null;
    for (const section of doc.sections) {
        if (section.offset <= offset)
            title = section.title;
        else
            break;
    }
    return title;
}
/**
 * Divide un documento en fragmentos citables. Los cortes respetan páginas y
 * secciones cuando el texto las identifica, y se solapan ligeramente para no
 * perder una frase que cae justo en el límite.
 */
export function chunkDocument(doc, target = 1400, overlap = 160) {
    const boundaries = new Set([0]);
    for (const start of doc.pageStarts)
        if (start > 0 && start < doc.text.length)
            boundaries.add(start);
    for (const section of doc.sections)
        if (section.offset > 0 && section.offset < doc.text.length)
            boundaries.add(section.offset);
    const sorted = [...boundaries].sort((a, b) => a - b);
    const chunks = [];
    for (let s = 0; s < sorted.length; s++) {
        const segmentStart = sorted[s];
        const segmentEnd = s + 1 < sorted.length ? sorted[s + 1] : doc.text.length;
        let cursor = segmentStart;
        while (cursor < segmentEnd) {
            let stop = Math.min(cursor + target, segmentEnd);
            if (stop < segmentEnd) {
                const window = doc.text.slice(cursor, stop);
                const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '));
                if (cut > target * 0.7)
                    stop = cursor + cut + 1;
            }
            const raw = doc.text.slice(cursor, stop).trim();
            // Los fragmentos demasiado cortos son ruido (páginas de copyright,
            // encabezados sueltos): no se envían al modelo.
            if (raw.length >= 40) {
                chunks.push({
                    index: chunks.length,
                    page: pageAt(doc, cursor),
                    charOffset: cursor,
                    section: sectionAt(doc, cursor),
                    text: raw,
                });
            }
            if (stop >= segmentEnd)
                break;
            cursor = Math.max(segmentStart, stop - overlap);
        }
    }
    return chunks;
}
export function fileBase64(filePath) {
    return fs.readFileSync(filePath).toString('base64');
}
export function safeUnlink(filePath) {
    try {
        fs.unlinkSync(filePath);
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=files.js.map