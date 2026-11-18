/**
 * Prueba directa de los generadores de la Fase 3: los bytes deben ser OOXML
 * real, no un texto renombrado. Se vuelve a leer el DOCX y el XLSX con
 * librerías distintas a las que los escribieron.
 */
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { generateDocument, safeFileName } from '../modules/ai/generate.js';
const input = {
    title: 'Derecho posesorio peruano',
    sourceLabel: 'Apunte de clase · fuente verificada',
    sections: [
        { heading: 'Concepto', body: 'La posesión es un poder de hecho sobre la cosa.\nSe distingue de la propiedad.' },
        { heading: 'Restitución', body: 'La restitución protege al poseedor frente a un despojo.' },
    ],
    columns: ['Tema', 'Norma'],
    rows: [
        ['Posesión', 'Código Civil'],
        ['Restitución', 'Código Civil'],
    ],
};
const zipEntries = (buffer) => {
    const entries = [];
    // El directorio central ZIP guarda los nombres sin comprimir: basta buscar
    // las cadenas ASCII para comprobar la estructura del paquete OOXML.
    for (const name of [
        '[Content_Types].xml', 'word/document.xml', 'ppt/presentation.xml',
        'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml',
        'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ]) {
        if (buffer.includes(Buffer.from(name, 'ascii')))
            entries.push(name);
    }
    return entries;
};
const assertOoxml = (buffer, expected) => {
    assert.ok(buffer.length > 1000, `archivo demasiado pequeño: ${buffer.length}`);
    assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304', 'debe ser un ZIP/OOXML real');
    assert.notEqual(buffer.subarray(0, 4).toString('ascii'), '%PDF');
    for (const name of expected) {
        assert.ok(zipEntries(buffer).includes(name), `falta la entrada ${name}`);
    }
};
const docx = await generateDocument('docx', input);
assertOoxml(docx.buffer, ['[Content_Types].xml', 'word/document.xml']);
const mammoth = (await import('mammoth')).default;
const rereadDocx = await mammoth.extractRawText({ buffer: docx.buffer });
assert.match(rereadDocx.value, /Derecho posesorio peruano/);
assert.match(rereadDocx.value, /poder de hecho sobre la cosa/);
assert.match(rereadDocx.value, /Código Civil/);
const pptx = await generateDocument('pptx', input);
assertOoxml(pptx.buffer, ['ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
const xlsx = await generateDocument('xlsx', input);
assertOoxml(xlsx.buffer, ['xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(xlsx.buffer);
assert.equal(workbook.worksheets.length, 2);
const sheet = workbook.getWorksheet('Contenido');
assert.ok(sheet, 'debe existir la hoja Contenido');
assert.equal(sheet.getCell('A1').value, 'Tema');
assert.equal(sheet.getCell('B1').value, 'Norma');
assert.equal(sheet.getCell('A2').value, 'Posesión');
assert.equal(sheet.getCell('A3').value, 'Restitución');
assert.equal(workbook.getWorksheet('Información')?.getCell('B2').value, 'Derecho posesorio peruano');
assert.equal(safeFileName('Derecho posesorio: ¿qué es?', 'docx'), 'Derecho-posesorio-que-es.docx');
console.log(JSON.stringify({
    ok: true,
    sizes: { docx: docx.buffer.length, pptx: pptx.buffer.length, xlsx: xlsx.buffer.length },
    mimes: { docx: docx.mime, pptx: pptx.mime, xlsx: xlsx.mime },
    rereadDocxChars: rereadDocx.value.length,
    xlsxRows: sheet.rowCount,
}));
//# sourceMappingURL=phase3-probe.js.map