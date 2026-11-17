import bcrypt from 'bcryptjs';
import { db, migrate, now, uuid } from './index.js';
import { config } from '../config.js';
const AREAS = [
    ['civil', 'Derecho Civil', 'Personas, familia, obligaciones, contratos, reales y sucesiones.'],
    ['penal', 'Derecho Penal', 'Delitos, penas, teoría del delito y ejecución penal.'],
    ['constitucional', 'Derecho Constitucional', 'Constitución, derechos fundamentales y control de constitucionalidad.'],
    ['procesal', 'Derecho Procesal', 'Procesos civiles, penales, contencioso-administrativos y de ejecución.'],
    ['comercial', 'Derecho Comercial', 'Contratos mercantiles, títulos valores y protección al consumidor.'],
    ['societario', 'Derecho Societario', 'Sociedades, gobierno corporativo y mercado de valores.'],
    ['laboral', 'Derecho Laboral', 'Relaciones de trabajo, remuneraciones y seguridad social.'],
    ['administrativo', 'Derecho Administrativo', 'Procedimiento administrativo, contrataciones y función pública.'],
    ['tributario', 'Derecho Tributario', 'Tributos, procedimientos y régimen sancionador.'],
    ['internacional', 'Derecho Internacional', 'Derecho internacional público y privado, tratados y tribunales.'],
    ['familia', 'Derecho de Familia', 'Matrimonio, filiación, alimentos, niñez y adolescencia.'],
    ['derechos_humanos', 'Derechos Humanos', 'Sistema interamericano, derechos fundamentales y justicia transicional.'],
];
const SOURCES = [
    ['elperuano', 'Diario Oficial El Peruano', 'https://elperuano.pe/', 'html'],
    ['spij', 'SPIJ — Sistema Peruano de Información Jurídica', 'https://spij.minjus.gob.pe/', 'html'],
    ['congreso', 'Congreso de la República del Perú', 'https://www.congreso.gob.pe/', 'html'],
    ['tc', 'Tribunal Constitucional del Perú', 'https://www.tc.gob.pe/', 'html'],
    ['pj', 'Poder Judicial del Perú', 'https://www.pj.gob.pe/', 'html'],
    ['minjus', 'Ministerio de Justicia y Derechos Humanos', 'https://www.gob.pe/minjus', 'html'],
    ['corteidh', 'Corte Interamericana de Derechos Humanos', 'https://www.corteidh.or.cr/', 'html'],
    ['cij', 'Corte Internacional de Justicia', 'https://www.icj-cij.org/', 'html'],
];
const NORMS = [
    { slug: 'constitucion-politica', title: 'Constitución Política del Perú', short: 'Constitución', number: null, type: 'constitucion', area: 'constitucional', entity: 'Congreso Constituyente Democrático', published: '1993-12-30', summary: 'Norma suprema del ordenamiento jurídico peruano.' },
    { slug: 'codigo-civil', title: 'Código Civil', short: 'Código Civil', number: 'Decreto Legislativo 295', type: 'codigo', area: 'civil', entity: 'Poder Ejecutivo', published: '1984-07-25', effective: '1984-11-14', summary: 'Regula personas, actos jurídicos, obligaciones, derechos reales, familia y sucesiones.' },
    { slug: 'codigo-penal', title: 'Código Penal', short: 'Código Penal', number: 'Decreto Legislativo 635', type: 'codigo', area: 'penal', entity: 'Poder Ejecutivo', published: '1991-04-08', summary: 'Tipifica delitos y establece penas y medidas de seguridad.' },
    { slug: 'codigo-procesal-civil', title: 'Código Procesal Civil', short: 'Código Procesal Civil', number: 'Decreto Legislativo 768', type: 'codigo', area: 'procesal', entity: 'Poder Ejecutivo', published: '1992-03-04', summary: 'Regula la actividad procesal civil y la tutela jurisdiccional efectiva.' },
    { slug: 'codigo-procesal-penal', title: 'Código Procesal Penal', short: 'Código Procesal Penal', number: 'Decreto Legislativo 957', type: 'codigo', area: 'procesal', entity: 'Poder Ejecutivo', published: '2004-07-29', summary: 'Establece el proceso penal acusatorio garantista.' },
    { slug: 'codigo-ejecucion-penal', title: 'Código de Ejecución Penal', short: 'Código de Ejecución Penal', number: 'Decreto Legislativo 654', type: 'codigo', area: 'penal', entity: 'Poder Ejecutivo', published: '1991-08-02', summary: 'Regula la ejecución de penas y el tratamiento penitenciario.' },
    { slug: 'codigo-ninos-adolescentes', title: 'Código de los Niños y Adolescentes', short: 'Código de los Niños y Adolescentes', number: 'Ley 27337', type: 'codigo', area: 'familia', entity: 'Congreso de la República', published: '2000-07-21', summary: 'Protege los derechos de niños y adolescentes y regula su tutela.' },
    { slug: 'codigo-consumidor', title: 'Código de Protección y Defensa del Consumidor', short: 'Código del Consumidor', number: 'Ley 29571', type: 'codigo', area: 'comercial', entity: 'Congreso de la República', published: '2010-09-02', summary: 'Protege los derechos de los consumidores y regula relaciones de consumo.' },
    { slug: 'codigo-tributario', title: 'Código Tributario', short: 'Código Tributario', number: 'Decreto Supremo 133-2013-EF', type: 'codigo', area: 'tributario', entity: 'Poder Ejecutivo', published: '2013-06-22', summary: 'Establece los principios y procedimientos del sistema tributario nacional. Texto único ordenado del Decreto Legislativo 816.', status: 'vigente' },
    { slug: 'codigo-procesal-constitucional', title: 'Código Procesal Constitucional', short: 'Código Procesal Constitucional', number: 'Ley 31307', type: 'codigo', area: 'constitucional', entity: 'Congreso de la República', published: '2021-07-23', effective: '2021-07-24', summary: 'Regula los procesos constitucionales de tutela de derechos. Publicado el 23 de julio de 2021 y vigente desde el 24 de julio de 2021.', status: 'vigente' },
    { slug: 'ley-general-sociedades', title: 'Ley General de Sociedades', short: 'Ley General de Sociedades', number: 'Ley 26887', type: 'ley', area: 'societario', entity: 'Congreso de la República', published: '1997-11-09', summary: 'Regula la constitución, organización y funcionamiento de sociedades.' },
    { slug: 'ley-titulos-valores', title: 'Ley de Títulos Valores', short: 'Ley de Títulos Valores', number: 'Ley 27287', type: 'ley', area: 'comercial', entity: 'Congreso de la República', published: '2000-06-19', summary: 'Regula los títulos valores y su circulación.' },
    { slug: 'lpaq', title: 'Ley del Procedimiento Administrativo General', short: 'LPAG', number: 'Ley 27444', type: 'ley', area: 'administrativo', entity: 'Congreso de la República', published: '2001-04-10', summary: 'Regula el procedimiento administrativo común ante las entidades públicas.' },
    { slug: 'ley-productividad-laboral', title: 'Ley de Productividad y Competitividad Laboral', short: 'LPCL', number: 'Decreto Legislativo 728', type: 'decreto_legislativo', area: 'laboral', entity: 'Poder Ejecutivo', published: '1992-11-12', summary: 'Regula el régimen laboral de la actividad privada.' },
    { slug: 'ley-transparencia', title: 'Ley de Transparencia y Acceso a la Información Pública', short: 'Ley de Transparencia', number: 'Ley 27806', type: 'ley', area: 'administrativo', entity: 'Congreso de la República', published: '2002-08-03', summary: 'Garantiza el derecho de acceso a la información pública.' },
    { slug: 'ley-universitaria', title: 'Ley Universitaria', short: 'Ley Universitaria', number: 'Ley 30220', type: 'ley', area: 'administrativo', entity: 'Congreso de la República', published: '2014-07-09', summary: 'Regula la educación universitaria y el sistema universitario.' },
    { slug: 'lopj', title: 'Ley Orgánica del Poder Judicial', short: 'LOPJ', number: 'Decreto Supremo 017-93-JUS', type: 'ley', area: 'procesal', entity: 'Poder Ejecutivo', published: '1993-05-28', effective: '1993-05-29', summary: 'Organiza el Poder Judicial y la carrera judicial. Texto único ordenado aprobado por Decreto Supremo 017-93-JUS.', status: 'vigente' },
    { slug: 'lomp', title: 'Ley Orgánica del Ministerio Público', short: 'LOMP', number: 'Decreto Legislativo 052', type: 'ley', area: 'procesal', entity: 'Poder Ejecutivo', published: '1981-05-19', summary: 'Organiza el Ministerio Público y sus funciones.', status: 'vigente' },
    { slug: 'ley-arbitraje', title: 'Ley de Arbitraje', short: 'Ley de Arbitraje', number: 'Decreto Legislativo 1071', type: 'ley', area: 'procesal', entity: 'Poder Ejecutivo', published: '2008-06-28', effective: '2008-09-01', summary: 'Regula el arbitraje nacional e internacional. Derogó la Ley 26572.', status: 'vigente' },
    { slug: 'ley-conciliacion', title: 'Ley de Conciliación', short: 'Ley de Conciliación', number: 'Ley 26872', type: 'ley', area: 'procesal', entity: 'Congreso de la República', published: '1997-11-13', summary: 'Regula la conciliación extrajudicial.' },
    { slug: 'codigo-procedimientos-penales', title: 'Código de Procedimientos Penales', short: 'Código de Procedimientos Penales', number: null, type: 'codigo', area: 'procesal', entity: 'Congreso de la República', published: null, summary: 'Régimen procesal penal anterior. Fue derogado por el Decreto Legislativo 957, Código Procesal Penal, con régimen de vigencia residual.', status: 'derogado' },
    { slug: 'ley-contrataciones', title: 'Ley General de Contrataciones Públicas', short: 'Contrataciones del Estado', number: 'Ley 32069', type: 'ley', area: 'administrativo', entity: 'Congreso de la República', published: '2024-06-24', effective: '2025-04-22', summary: 'Regula las contrataciones de bienes, servicios y obras del Estado. Publicada el 24 de junio de 2024 y vigente desde el 22 de abril de 2025, tras la publicación de su reglamento (vigésima novena disposición complementaria final).' },
    { slug: 'ley-delitos-aduaneros', title: 'Ley de Delitos Aduaneros', short: 'Delitos Aduaneros', number: 'Ley 28008', type: 'ley', area: 'penal', entity: 'Congreso de la República', published: null, summary: 'Tipifica los delitos aduaneros y regula su persecución.' },
    { slug: 'ley-procedimiento-ejecucion-coactiva', title: 'Ley del Procedimiento de Ejecución Coactiva', short: 'Ejecución Coactiva', number: 'Ley 26979', type: 'ley', area: 'administrativo', entity: 'Congreso de la República', published: '1998-09-23', summary: 'Regula la cobranza coactiva de obligaciones públicas. Texto único ordenado aprobado por Decreto Supremo 018-2008-JUS.', status: 'vigente' },
    { slug: 'codigo-comercio', title: 'Código de Comercio', short: 'Código de Comercio', number: 'Código de Comercio de 1902', type: 'codigo', area: 'comercial', entity: 'Congreso de la República', published: null, summary: 'Norma histórica del derecho mercantil peruano, vigente de forma parcial y supletoria en materias no reguladas por leyes posteriores.', status: 'parcialmente_derogado' },
    { slug: 'ley-seguridad-salud-trabajo', title: 'Ley de Seguridad y Salud en el Trabajo', short: 'Ley de Seguridad y Salud en el Trabajo', number: 'Ley 29783', type: 'ley', area: 'laboral', entity: 'Congreso de la República', published: '2011-08-20', summary: 'Establece deberes y derechos en materia de prevención de riesgos laborales.', status: 'vigente' },
    { slug: 'nueva-ley-procesal-trabajo', title: 'Nueva Ley Procesal del Trabajo', short: 'Nueva Ley Procesal del Trabajo', number: 'Ley 29497', type: 'ley', area: 'laboral', entity: 'Congreso de la República', published: '2010-01-15', summary: 'Regula el proceso laboral oral y la tutela jurisdiccional de derechos laborales.', status: 'vigente' },
];
function upsertAreas() {
    const stmt = db.prepare('INSERT OR IGNORE INTO legal_areas (slug, name, description) VALUES (?, ?, ?)');
    for (const [slug, name, description] of AREAS)
        stmt.run(slug, name, description);
}
function upsertSources() {
    const stmt = db.prepare(`
    INSERT INTO sources (id, key, name, url, kind, enabled, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      kind = excluded.kind,
      enabled = excluded.enabled,
      notes = excluded.notes
  `);
    for (const [key, name, url, kind] of SOURCES) {
        const isOfficialFeed = key === 'elperuano';
        stmt.run(`src_${key}`, key, isOfficialFeed ? 'Diario Oficial El Peruano — Normas Legales' : name, isOfficialFeed ? 'https://diariooficial.elperuano.pe/Normas/LoadNormasLegales' : url, isOfficialFeed ? 'html' : kind, isOfficialFeed ? 1 : 0, isOfficialFeed
            ? 'Fuente oficial activa: normas legales publicadas en el Diario Oficial El Peruano.'
            : null);
    }
}
function upsertNorms() {
    const findSource = db.prepare('SELECT id FROM sources WHERE key = ?');
    const spij = findSource.get('spij');
    const insert = db.prepare(`
    INSERT INTO norms
      (id, slug, title, short_title, number, type, area, entity, published_at, effective_at, status, official_url, source_id, summary, verification)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending')
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      short_title = excluded.short_title,
      number = excluded.number,
      type = excluded.type,
      area = excluded.area,
      entity = excluded.entity,
      published_at = COALESCE(excluded.published_at, norms.published_at),
      -- La vigencia solo se escribe cuando consta en el texto oficial.
      effective_at = COALESCE(excluded.effective_at, norms.effective_at),
      summary = excluded.summary,
      status = CASE WHEN norms.verification = 'verified' THEN norms.status ELSE excluded.status END,
      updated_at = datetime('now')
  `);
    for (const n of NORMS) {
        insert.run(uuid(), n.slug, n.title, n.short, n.number, n.type, n.area, n.entity, n.published, n.effective ?? null, n.status ?? 'por_verificar', spij?.id ?? null, n.summary);
    }
}
function createUser(email, password, name, role, extra = {}) {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists)
        return exists;
    const id = uuid();
    db.prepare(`
    INSERT INTO users (id, email, password_hash, name, university, university_type, city, cycle, bio, role, email_verified, onboarded)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, bcrypt.hashSync(password, 10), name, extra.university ?? null, extra.universityType ?? null, extra.city ?? null, extra.cycle ?? null, extra.bio ?? null, role, extra.verified ? 1 : 0, 1);
    return { id };
}
function seedDemo() {
    const pass = 'Demo1234!';
    const a = createUser('demo.andrea@etonlex.pe', pass, 'Andrea Quispe', 'student', {
        university: 'Universidad Nacional Mayor de San Marcos', universityType: 'publica', city: 'Lima', cycle: '6.º ciclo', bio: 'Interesada en Derecho Civil y Constitucional.', verified: true,
    });
    const b = createUser('demo.rafael@etonlex.pe', pass, 'Rafael Mendoza', 'student', {
        university: 'Pontificia Universidad Católica del Perú', universityType: 'privada', city: 'Lima', cycle: '8.º ciclo', bio: 'Derecho Penal y litigio.', verified: true,
    });
    const c = createUser('demo.lucia@etonlex.pe', pass, 'Lucía Torres', 'student', {
        university: 'Universidad Nacional de Arequipa', universityType: 'publica', city: 'Arequipa', cycle: '4.º ciclo', bio: 'Derecho Laboral y derechos humanos.', verified: true,
    });
    db.prepare('INSERT OR IGNORE INTO user_interests (user_id, area) VALUES (?, ?)').run(a.id, 'civil');
    db.prepare('INSERT OR IGNORE INTO user_interests (user_id, area) VALUES (?, ?)').run(a.id, 'constitucional');
    db.prepare('INSERT OR IGNORE INTO user_interests (user_id, area) VALUES (?, ?)').run(b.id, 'penal');
    db.prepare('INSERT OR IGNORE INTO user_interests (user_id, area) VALUES (?, ?)').run(c.id, 'laboral');
    db.prepare(`INSERT OR IGNORE INTO friendships (id, requester_id, addressee_id, status, responded_at) VALUES (?, ?, ?, 'accepted', datetime('now'))`)
        .run(uuid(), a.id, b.id);
    db.prepare(`INSERT OR IGNORE INTO friendships (id, requester_id, addressee_id, status, responded_at) VALUES (?, ?, ?, 'accepted', datetime('now'))`)
        .run(uuid(), a.id, c.id);
    const conv = db.prepare('SELECT id FROM conversations WHERE type = ? AND created_by = ?').get('direct', a.id);
    let convId = conv?.id;
    if (!convId) {
        convId = uuid();
        db.prepare('INSERT INTO conversations (id, type, created_by, last_message_at) VALUES (?, ?, ?, datetime(\'now\'))').run(convId, 'direct', a.id);
        db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(convId, a.id);
        db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(convId, b.id);
        db.prepare('INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, ?)')
            .run(uuid(), convId, b.id, 'Andrea, ¿ya revisaste el expediente del caso?');
    }
    console.log(`  · Usuarios demo: demo.andrea@etonlex.pe / demo.rafael@etonlex.pe / demo.lucia@etonlex.pe  (clave: ${pass})`);
}
function main() {
    migrate();
    upsertAreas();
    upsertSources();
    upsertNorms();
    if (config.seedAdmin.email && config.seedAdmin.password) {
        createUser(config.seedAdmin.email, config.seedAdmin.password, config.seedAdmin.name, 'admin', { verified: true });
        console.log(`  · Administrador: ${config.seedAdmin.email}`);
    }
    else {
        console.log('  · Sin SEED_ADMIN_EMAIL: no se creó administrador.');
    }
    if (process.argv.includes('--demo')) {
        seedDemo();
        console.log('  · Modo demo activado (cuentas marcadas como demostración).');
    }
    const counts = {
        areas: db.prepare('SELECT COUNT(*) c FROM legal_areas').get().c,
        sources: db.prepare('SELECT COUNT(*) c FROM sources').get().c,
        norms: db.prepare('SELECT COUNT(*) c FROM norms').get().c,
        users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    };
    console.log('ETON LEX · seed completado', { ...counts, at: now() });
}
main();
//# sourceMappingURL=seed.js.map