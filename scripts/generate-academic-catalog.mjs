#!/usr/bin/env node
/**
 * Genera el catálogo académico de ETON LEX desde los datasets oficiales de SUNEDU.
 *
 * Fuentes:
 * - Licenciamiento institucional: https://www.datosabiertos.gob.pe/dataset/sunedu-licenciamiento-institucional
 * - Programas académicos: https://www.datosabiertos.gob.pe/dataset/sunedu-programas-académicos
 *
 * Uso:
 * node scripts/generate-academic-catalog.mjs <licenciamiento.csv> <programas.csv> <salida.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , licPath, progPath, outPath] = process.argv;
if (!licPath || !progPath || !outPath) {
  console.error('Uso: node scripts/generate-academic-catalog.mjs <licenciamiento.csv> <programas.csv> <salida.json>');
  process.exit(1);
}

const decoder = new TextDecoder('windows-1252');
function readCsv(path) {
  const text = decoder.decode(readFileSync(path));
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = lines[0].split('|').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split('|');
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]));
  });
}

function normalizeName(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function displayName(value) {
  return value
    .toLocaleLowerCase('es')
    .replace(/(^|[\s\-/])(\p{L})/gu, (_, separator, letter) => separator + letter.toLocaleUpperCase('es'))
    .replace(/\b(upao|unmsm|unsa|unp|utp|usil|upc|ucsm|unfv|une|unheval|undac)\b/gi, (m) => m.toUpperCase());
}

const licenseRows = readCsv(licPath);
const programRows = readCsv(progPath);
const byId = new Map();

function licenseStatus(raw) {
  const value = normalizeName(raw);
  if (value.includes('OTORGADA') || value.includes('VIGENTE')) return 'vigente';
  if (value.includes('DENEGADA')) return 'denegada';
  if (value.includes('CANCELADA')) return 'cancelada';
  if (value.includes('EXPIRADA') || value.includes('VENCIDA')) return 'expirada';
  if (value.includes('EN PROCESO') || value.includes('TRAMITE')) return 'en_proceso';
  return 'otra';
}

for (const row of licenseRows) {
  const id = row.CODIGO_ENTIDAD;
  if (!id) continue;
  byId.set(id, {
    id,
    name: row.NOMBRE,
    nameKey: normalizeName(row.NOMBRE),
    type: ['PUBLICO', 'PUBLICA'].includes(normalizeName(row.TIPO_GESTION)) ? 'publica' : 'privada',
    licenseStatus: licenseStatus(row.ESTADO_LICENCIAMIENTO),
    licenseStatusRaw: row.ESTADO_LICENCIAMIENTO,
    licenseStart: row.FECHA_INICIO_LICENCIAMIENTO || null,
    licenseEnd: row.FECHA_FIN_LICENCIAMIENTO || null,
    department: row.DEPARTAMENTO ? displayName(row.DEPARTAMENTO) : null,
    province: row.PROVINCIA ? displayName(row.PROVINCIA) : null,
    district: row.DISTRITO ? displayName(row.DISTRITO) : null,
    campuses: [],
    programs: [],
  });
}

const campusKeys = new Map();
const programKeys = new Map();
for (const row of programRows) {
  const uni = byId.get(row.CODIGO_ENTIDAD);
  if (!uni) continue;

  const campusName = row.NOMBRE_FILIAL || uni.name;
  const campusId = `${uni.id}:${row.CODIGO_FILIAL || normalizeName(campusName)}`;
  if (!campusKeys.has(campusId)) {
    campusKeys.set(campusId, true);
    uni.campuses.push({
      id: campusId,
      code: row.CODIGO_FILIAL || null,
      name: displayName(campusName),
      nameKey: normalizeName(campusName),
      department: row.DEPARTAMENTO_FILIAL ? displayName(row.DEPARTAMENTO_FILIAL) : null,
      province: row.PROVINCIA_FILIAL ? displayName(row.PROVINCIA_FILIAL) : null,
    });
  }

  const career = row.DENOMINACION_PROGRAMA;
  if (!career) continue;
  const level = row.NIVEL_ACADEMICO || null;
  const area = row.NOMBRE_CLASE_PROGRAMA_N2 ? displayName(row.NOMBRE_CLASE_PROGRAMA_N2) : null;
  const programId = `${campusId}:${normalizeName(career)}:${normalizeName(level ?? '')}:${normalizeName(area ?? '')}`;
  if (!programKeys.has(programId)) {
    programKeys.set(programId, true);
    uni.programs.push({
      id: programId,
      campusId,
      name: displayName(career),
      nameKey: normalizeName(career),
      level,
      area,
      authorization: row.TIPO_AUTORIZACION_PROGRAMA || null,
    });
  }
}

const universities = [...byId.values()]
  .map((uni) => ({
    ...uni,
    campuses: uni.campuses.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    programs: uni.programs.sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));

const catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: {
    publisher: 'Superintendencia Nacional de Educación Superior Universitaria — SUNEDU',
    license: 'Open Data Commons Attribution License (ODC-BY)',
    licenseUrl: 'https://opendefinition.org/licenses/odc-by/',
    institutionalLicensingDataset: 'https://www.datosabiertos.gob.pe/dataset/sunedu-licenciamiento-institucional',
    academicProgramsDataset: 'https://www.datosabiertos.gob.pe/dataset/sunedu-programas-acad%C3%A9micos',
    dataCutoff: '2024-08-28',
  },
  note: 'Facultad no forma parte de los datasets oficiales usados; el campo "area" corresponde a NOMBRE_CLASE_PROGRAMA_N2 de SUNEDU. No se inventan facultades.',
  universities,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(catalog)}\n`, 'utf8');
console.log(`Catálogo generado: ${universities.length} universidades, ${campusKeys.size} sedes/filiales, ${programKeys.size} programas → ${outPath}`);
