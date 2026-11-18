/**
 * Generación real de documentos en el backend.
 *
 * No se producen PDF ni archivos de adorno: los tres formatos se escriben con
 * librerías que generan OOXML válido y se devuelven como bytes para persistirlos
 * bajo DATA_DIR/uploads/generated.
 */
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, } from 'docx';
const MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const MAX_SLIDES = 30;
function splitLines(body) {
    return body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
export function safeFileName(title, ext) {
    const clean = title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'documento';
    return `${clean}.${ext}`;
}
async function toDocx(input) {
    const children = [
        new Paragraph({
            text: input.title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
        }),
    ];
    if (input.sourceLabel) {
        children.push(new Paragraph({
            children: [new TextRun({ text: input.sourceLabel, italics: true, size: 20, color: '666666' })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
        }));
    }
    for (const section of input.sections) {
        if (section.heading) {
            children.push(new Paragraph({
                text: section.heading,
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 240, after: 120 },
            }));
        }
        for (const line of splitLines(section.body)) {
            children.push(new Paragraph({
                children: [new TextRun({ text: line, size: 24 })],
                spacing: { after: 120 },
            }));
        }
    }
    if (input.columns?.length && input.rows?.length) {
        const header = new TableRow({
            tableHeader: true,
            children: input.columns.map((column) => new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: column, bold: true })] })],
            })),
        });
        const body = input.rows.slice(0, 500).map((row) => new TableRow({
            children: input.columns.map((column, index) => {
                const value = Array.isArray(row) ? row[index] : row[column];
                return new TableCell({
                    children: [new Paragraph({ text: value === undefined || value === null ? '' : String(value) })],
                });
            }),
        }));
        children.push(new Paragraph({ text: 'Datos', heading: HeadingLevel.HEADING_1 }));
        children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [header, ...body],
        }));
    }
    children.push(new Paragraph({
        children: [new TextRun({ text: 'Generado por ETON LEX', italics: true, size: 18, color: '888888' })],
        spacing: { before: 360 },
    }));
    const doc = new Document({
        creator: 'ETON LEX',
        title: input.title,
        description: input.sourceLabel ?? 'Documento generado por ETON LEX',
        sections: [{ children }],
    });
    return Buffer.from(await Packer.toBuffer(doc));
}
async function toPptx(input) {
    const pptx = new PptxGenJS();
    pptx.author = 'ETON LEX';
    pptx.company = 'ETON LEX';
    pptx.title = input.title;
    pptx.subject = input.sourceLabel ?? 'Documento generado por ETON LEX';
    pptx.layout = 'LAYOUT_16x9';
    const cover = pptx.addSlide();
    cover.addText(input.title, { x: 0.7, y: 1.6, w: 8.6, h: 1.6, fontSize: 34, bold: true, color: '0B3B5B' });
    cover.addText(input.sourceLabel ?? 'ETON LEX · documento generado', {
        x: 0.7, y: 5.9, w: 8.6, h: 0.5, fontSize: 13, color: '666666',
    });
    let count = 1;
    for (const section of input.sections) {
        if (count >= MAX_SLIDES)
            break;
        const lines = splitLines(section.body);
        if (!section.heading && lines.length === 0)
            continue;
        const slide = pptx.addSlide();
        if (section.heading) {
            slide.addText(section.heading, { x: 0.7, y: 0.6, w: 8.6, h: 0.8, fontSize: 26, bold: true, color: '0B3B5B' });
        }
        lines.slice(0, 9).forEach((line, index) => {
            slide.addText(line, {
                x: 0.9,
                y: 1.7 + index * 0.47,
                w: 8.2,
                h: 0.42,
                fontSize: 17,
                color: '243447',
                bullet: { code: '2022' },
            });
        });
        count += 1;
    }
    if (input.columns?.length && input.rows?.length && count < MAX_SLIDES) {
        const slide = pptx.addSlide();
        slide.addText('Datos', { x: 0.7, y: 0.6, w: 8.6, h: 0.8, fontSize: 26, bold: true, color: '0B3B5B' });
        const head = input.columns.join('   |   ');
        const preview = input.rows.slice(0, 8).map((row) => (input.columns.map((column, index) => String(Array.isArray(row) ? row[index] ?? '' : row[column] ?? '')).join('   |   ')));
        slide.addText([head, ...preview].join('\n'), {
            x: 0.8, y: 1.6, w: 8.4, h: 4.8, fontSize: 14, color: '243447', fontFace: 'Consolas',
        });
    }
    return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }));
}
async function toXlsx(input) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ETON LEX';
    workbook.lastModifiedBy = 'ETON LEX';
    workbook.created = new Date();
    workbook.modified = new Date();
    const sheet = workbook.addWorksheet('Contenido', { views: [{ state: 'frozen', ySplit: 1 }] });
    const detected = input.columns?.length
        ? input.columns
        : Object.keys((input.rows?.find((r) => !Array.isArray(r)) ?? {}));
    const columns = detected.length ? detected : ['Contenido'];
    sheet.columns = columns.map((header) => ({ header, key: header, width: 28 }));
    if (input.rows?.length) {
        for (const row of input.rows) {
            const values = Array.isArray(row)
                ? Object.fromEntries(columns.map((column, index) => [column, row[index] ?? '']))
                : row;
            sheet.addRow(values);
        }
    }
    else {
        let rowNumber = 1;
        for (const section of input.sections) {
            sheet.addRow({ [columns[0]]: section.heading ?? `Sección ${rowNumber}` });
            rowNumber += 1;
            for (const line of splitLines(section.body)) {
                sheet.addRow({ [columns[0]]: line });
                rowNumber += 1;
            }
        }
    }
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3B5B' } };
    header.alignment = { vertical: 'middle' };
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: columns.length },
    };
    const info = workbook.addWorksheet('Información');
    info.columns = [{ header: 'Campo', width: 24 }, { header: 'Valor', width: 80 }];
    info.addRow(['Título', input.title]);
    info.addRow(['Origen', input.sourceLabel ?? 'ETON LEX']);
    info.addRow(['Generado', new Date().toISOString()]);
    info.addRow(['Formato', 'XLSX real generado en backend']);
    info.getRow(1).font = { bold: true };
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
/** Genera bytes de un documento real. Nunca devuelve una extensión engañosa. */
export async function generateDocument(kind, input) {
    if (!input.title.trim())
        throw new Error('El título no puede estar vacío.');
    const sections = input.sections.filter((s) => s.body.trim() || s.heading?.trim());
    const payload = { ...input, title: input.title.trim(), sections };
    const buffer = kind === 'docx'
        ? await toDocx(payload)
        : kind === 'pptx'
            ? await toPptx(payload)
            : await toXlsx(payload);
    if (buffer.length < 500)
        throw new Error('El documento generado quedó vacío.');
    return { buffer, mime: MIME[kind], ext: kind };
}
//# sourceMappingURL=generate.js.map