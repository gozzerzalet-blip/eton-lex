import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../../config.js';
import { db, logAudit, tx, uuid } from '../../db/index.js';
import {
  clearRefreshCookie, createRefreshToken, publicUser, requireAuth, revokeAllSessions,
  revokeSession, rotateRefreshToken, setRefreshCookie, signAccess, type SessionUser,
} from '../../lib/auth.js';
import { sendEmailVerificationCode, sendLoginCode, sendPasswordResetCode } from '../../lib/mailer.js';
import { ApiError, asyncHandler, badRequest, conflict, unauthorized } from '../../lib/http.js';

export const authRouter = Router();

const emailSchema = z.string().trim().toLowerCase().email('Correo electrónico inválido.').max(160);
const passwordSchema = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200);

const RESET_TTL_MINUTES = 15;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_SECONDS = 60;
const RESET_MESSAGE = 'Si el correo está registrado, enviamos un código con las instrucciones.';

const VERIFY_TTL_MINUTES = 15;
const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_RESEND_SECONDS = 60;

const LOGIN_TTL_MINUTES = 10;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_RESEND_SECONDS = 60;
const LOGIN_CODE_MESSAGE = 'Si el correo está registrado, enviamos un código para ingresar.';

const EMAIL_NOT_READY = () => new ApiError(
  503,
  'EMAIL_NOT_CONFIGURED',
  'El correo de la plataforma todavía no está configurado. Inténtalo más tarde.',
);

/** Genera un código nuevo, lo guarda solo como hash y lo envía al correo real. */
async function issueEmailVerification(userId: string, email: string, ip?: string): Promise<void> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = uuid();
  db.prepare(`
    INSERT INTO email_verifications (id, user_id, email, code_hash, expires_at, requested_ip)
    VALUES (?, ?, ?, ?, datetime('now', '+${VERIFY_TTL_MINUTES} minutes'), ?)
  `).run(id, userId, email, bcrypt.hashSync(code, 10), ip ?? null);

  try {
    await sendEmailVerificationCode(email, code);
  } catch (err) {
    db.prepare('DELETE FROM email_verifications WHERE id = ?').run(id);
    throw err;
  }

  db.prepare(`
    UPDATE email_verifications SET consumed_at = datetime('now')
    WHERE user_id = ? AND id != ? AND consumed_at IS NULL
  `).run(userId, id);
}

/** Código de ingreso sin contraseña: se envía solo al correo de la cuenta. */
async function issueLoginCode(userId: string, email: string, ip?: string): Promise<void> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = uuid();
  db.prepare(`
    INSERT INTO login_codes (id, user_id, email, code_hash, expires_at, requested_ip)
    VALUES (?, ?, ?, ?, datetime('now', '+${LOGIN_TTL_MINUTES} minutes'), ?)
  `).run(id, userId, email, bcrypt.hashSync(code, 10), ip ?? null);

  try {
    await sendLoginCode(email, code);
  } catch (err) {
    db.prepare('DELETE FROM login_codes WHERE id = ?').run(id);
    throw err;
  }

  db.prepare(`
    UPDATE login_codes SET consumed_at = datetime('now')
    WHERE user_id = ? AND id != ? AND consumed_at IS NULL
  `).run(userId, id);
}

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Ingresa tu nombre.').max(80),
  email: emailSchema,
  password: passwordSchema,
  username: z.string().trim().min(3, 'El nombre de usuario debe tener al menos 3 caracteres.').max(30).optional().nullable(),
  university: z.string().trim().max(160).optional().nullable(),
  universityId: z.string().trim().max(40).optional().nullable(),
  campusId: z.string().trim().max(80).optional().nullable(),
  universityType: z.enum(['publica', 'privada']).optional().nullable(),
  faculty: z.string().trim().max(120).optional().nullable(),
  career: z.string().trim().max(160).optional().nullable(),
  country: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional().nullable(),
  cycle: z.string().trim().max(40).optional().nullable(),
  missingUniversity: z.string().trim().max(240).optional().nullable(),
});

function slug(value: string): string {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
}

function uniqueUsername(preferred: string | null | undefined, fallback: string): string {
  const base = (preferred && slug(preferred)) || slug(fallback) || 'estudiante';
  let candidate = base.slice(0, 24);
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) {
    candidate = `${base.slice(0, 20)}${suffix++}`;
  }
  return candidate;
}

function uniquePublicId(): string {
  let id = crypto.randomBytes(5).toString('hex').toUpperCase();
  while (db.prepare('SELECT 1 FROM users WHERE public_id = ?').get(id)) {
    id = crypto.randomBytes(5).toString('hex').toUpperCase();
  }
  return id;
}

authRouter.post('/register', asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email);
  if (exists) throw conflict('Ya existe una cuenta con ese correo.');

  const id = uuid();
  const username = uniqueUsername(data.username, data.name);
  const publicId = uniquePublicId();
  db.prepare(`
    INSERT INTO users (
      id, email, password_hash, name, username, public_id, university, university_id, campus_id,
      university_type, faculty, career, country, city, cycle, email_verified, onboarded
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
  `).run(
    id, data.email, bcrypt.hashSync(data.password, 11), data.name, username, publicId,
    data.university ?? null, data.universityId ?? null, data.campusId ?? null, data.universityType ?? null,
    data.faculty ?? null, data.career ?? null, data.country ?? 'Perú', data.city ?? null, data.cycle ?? null,
  );
  if (data.missingUniversity) {
    db.prepare(`
      INSERT INTO reports (id, reporter_id, target_type, target_id, reason, status)
      VALUES (?, ?, 'university', ?, ?, 'open')
    `).run(uuid(), id, 'catalog-request', `Solicitud de universidad: ${data.missingUniversity}`);
  }

  let requiresEmailVerification = false;
  let emailDeliveryFailed = false;
  if (config.smtp.configured) {
    try {
      await issueEmailVerification(id, data.email, req.ip);
      requiresEmailVerification = true;
    } catch (err) {
      // La cuenta ya fue creada: conservarla permite reenviar el código después.
      // Nunca se simula un envío ni se devuelve el código al navegador.
      emailDeliveryFailed = true;
      console.error('[auth] no se pudo enviar el código de verificación al registrar:', (err as Error).message);
    }
  }
  logAudit(id, 'auth.register', { email: data.email, requiresEmailVerification }, req.ip);

  const user: SessionUser = { id, email: data.email, name: data.name, role: 'student', avatar_url: null };
  setRefreshCookie(res, createRefreshToken(id, req));
  res.status(201).json({
    accessToken: signAccess(user),
    user: publicUser(id, true),
    email: data.email,
    emailConfigured: config.smtp.configured,
    requiresEmailVerification,
    emailDeliveryFailed,
  });
}));

authRouter.post('/login', asyncHandler(async (req, res) => {
  const data = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(req.body);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email) as any;
  if (!row || !bcrypt.compareSync(data.password, row.password_hash)) {
    throw unauthorized('Correo o contraseña incorrectos.');
  }
  const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role, avatar_url: row.avatar_url };
  setRefreshCookie(res, createRefreshToken(row.id, req));
  db.prepare('UPDATE users SET last_seen_at = datetime(\'now\') WHERE id = ?').run(row.id);
  logAudit(row.id, 'auth.login', {}, req.ip);
  res.json({ accessToken: signAccess(user), user: publicUser(row.id, true) });
}));

// Ingreso con código: cualquier cuenta puede entrar aunque haya olvidado su
// contraseña. El código solo llega al correo registrado; nunca se devuelve.
authRouter.post('/request-login-code', asyncHandler(async (req, res) => {
  if (!config.smtp.configured) throw EMAIL_NOT_READY();

  const { email } = z.object({ email: emailSchema }).parse(req.body);
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as
    | { id: string; email: string }
    | undefined;

  if (user) {
    db.prepare(`
      DELETE FROM login_codes
      WHERE email = ? AND (expires_at <= datetime('now') OR consumed_at IS NOT NULL)
    `).run(email);

    const recent = db.prepare(`
      SELECT created_at FROM login_codes
      WHERE email = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(email) as { created_at: string } | undefined;

    const secondsSince = recent
      ? (Date.now() - new Date(`${recent.created_at.replace(' ', 'T')}Z`).getTime()) / 1000
      : Infinity;

    if (secondsSince >= LOGIN_RESEND_SECONDS) {
      await issueLoginCode(user.id, email, req.ip);
      logAudit(user.id, 'auth.request_login_code', {}, req.ip);
    }
  }

  // Misma respuesta siempre: no revela si la cuenta existe.
  res.json({ ok: true, message: LOGIN_CODE_MESSAGE });
}));

authRouter.post('/login-with-code', asyncHandler(async (req, res) => {
  if (!config.smtp.configured) throw EMAIL_NOT_READY();

  const data = z.object({
    email: emailSchema,
    code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
  }).parse(req.body);

  const row = db.prepare(`
    SELECT * FROM login_codes
    WHERE email = ? AND consumed_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(data.email) as any;

  if (!row) throw badRequest('El código expiró o no es válido. Solicita uno nuevo.');

  if (!bcrypt.compareSync(data.code, row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      db.prepare("UPDATE login_codes SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
      throw badRequest('Demasiados intentos incorrectos. Solicita un código nuevo.');
    }
    db.prepare('UPDATE login_codes SET attempts = ? WHERE id = ?').run(attempts, row.id);
    throw badRequest('El código no es correcto.');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as any;
  if (!user) throw badRequest('El código expiró o no es válido. Solicita uno nuevo.');

  db.prepare("UPDATE login_codes SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
  const sessionUser: SessionUser = {
    id: user.id, email: user.email, name: user.name, role: user.role, avatar_url: user.avatar_url,
  };
  setRefreshCookie(res, createRefreshToken(user.id, req));
  db.prepare('UPDATE users SET last_seen_at = datetime(\'now\') WHERE id = ?').run(user.id);
  logAudit(user.id, 'auth.login_with_code', {}, req.ip);
  res.json({ accessToken: signAccess(sessionUser), user: publicUser(user.id, true) });
}));

authRouter.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = z.object({ email: emailSchema }).parse(req.body);
  if (!config.smtp.configured) {
    throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'El correo de la plataforma todavía no está configurado. Inténtalo más tarde.');
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as
    | { id: string; email: string }
    | undefined;

  if (user) {
    db.prepare(`
      DELETE FROM password_resets
      WHERE email = ? AND (expires_at <= datetime('now') OR consumed_at IS NOT NULL)
    `).run(email);

    const recent = db.prepare(`
      SELECT created_at FROM password_resets
      WHERE email = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(email) as { created_at: string } | undefined;

    const secondsSince = recent
      ? (Date.now() - new Date(`${recent.created_at.replace(' ', 'T')}Z`).getTime()) / 1000
      : Infinity;

    if (secondsSince >= RESET_RESEND_SECONDS) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const id = uuid();
      db.prepare(`
        INSERT INTO password_resets (id, user_id, email, code_hash, expires_at, requested_ip)
        VALUES (?, ?, ?, ?, datetime('now', '+${RESET_TTL_MINUTES} minutes'), ?)
      `).run(id, user.id, email, bcrypt.hashSync(code, 10), req.ip ?? null);

      try {
        await sendPasswordResetCode(email, code);
      } catch (err) {
        db.prepare('DELETE FROM password_resets WHERE id = ?').run(id);
        throw err;
      }

      db.prepare(`
        UPDATE password_resets SET consumed_at = datetime('now')
        WHERE email = ? AND id != ? AND consumed_at IS NULL
      `).run(email, id);
      logAudit(user.id, 'auth.forgot_password', {}, req.ip);
    }
  }

  // Respuesta idéntica siempre: no revela si la cuenta existe.
  res.json({ ok: true, message: RESET_MESSAGE });
}));

authRouter.post('/reset-password', asyncHandler(async (req, res) => {
  const data = z.object({
    email: emailSchema,
    code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
    password: passwordSchema,
  }).parse(req.body);

  const row = db.prepare(`
    SELECT * FROM password_resets
    WHERE email = ? AND consumed_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(data.email) as any;

  if (!row) throw badRequest('El código expiró o no es válido. Solicita uno nuevo.');

  if (!bcrypt.compareSync(data.code, row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= RESET_MAX_ATTEMPTS) {
      db.prepare("UPDATE password_resets SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
      throw badRequest('Demasiados intentos incorrectos. Solicita un código nuevo.');
    }
    db.prepare('UPDATE password_resets SET attempts = ? WHERE id = ?').run(attempts, row.id);
    throw badRequest('El código no es correcto.');
  }

  tx(() => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(bcrypt.hashSync(data.password, 11), row.user_id);
    db.prepare("UPDATE password_resets SET consumed_at = datetime('now') WHERE user_id = ? AND consumed_at IS NULL")
      .run(row.user_id);
  });
  revokeAllSessions(row.user_id);
  logAudit(row.user_id, 'auth.reset_password', {}, req.ip);
  clearRefreshCookie(res);
  res.json({ ok: true, message: 'Contraseña actualizada. Ahora puedes iniciar sesión.' });
}));

authRouter.post('/verify-email', requireAuth, asyncHandler(async (req, res) => {
  if (!config.smtp.configured) throw EMAIL_NOT_READY();

  const { code } = z.object({
    code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos.'),
  }).parse(req.body);

  const row = db.prepare(`
    SELECT * FROM email_verifications
    WHERE user_id = ? AND consumed_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user!.id) as any;

  if (!row) throw badRequest('El código expiró o no es válido. Solicita uno nuevo.');

  if (!bcrypt.compareSync(code, row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= VERIFY_MAX_ATTEMPTS) {
      db.prepare("UPDATE email_verifications SET consumed_at = datetime('now') WHERE id = ?").run(row.id);
      throw badRequest('Demasiados intentos incorrectos. Solicita un código nuevo.');
    }
    db.prepare('UPDATE email_verifications SET attempts = ? WHERE id = ?').run(attempts, row.id);
    throw badRequest('El código no es correcto.');
  }

  tx(() => {
    db.prepare("UPDATE users SET email_verified = 1, updated_at = datetime('now') WHERE id = ?")
      .run(req.user!.id);
    db.prepare("UPDATE email_verifications SET consumed_at = datetime('now') WHERE user_id = ? AND consumed_at IS NULL")
      .run(req.user!.id);
  });
  logAudit(req.user!.id, 'auth.verify_email', {}, req.ip);
  res.json({ ok: true, user: publicUser(req.user!.id, true) });
}));

authRouter.post('/resend-verification', requireAuth, asyncHandler(async (req, res) => {
  if (!config.smtp.configured) throw EMAIL_NOT_READY();

  const user = db.prepare('SELECT id, email, email_verified FROM users WHERE id = ?')
    .get(req.user!.id) as { id: string; email: string; email_verified: number };
  if (user.email_verified) {
    res.json({ ok: true, message: 'Tu correo ya está verificado.' });
    return;
  }

  db.prepare(`
    DELETE FROM email_verifications
    WHERE user_id = ? AND (expires_at <= datetime('now') OR consumed_at IS NOT NULL)
  `).run(user.id);

  const recent = db.prepare(`
    SELECT created_at FROM email_verifications
    WHERE user_id = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(user.id) as { created_at: string } | undefined;

  const secondsSince = recent
    ? (Date.now() - new Date(`${recent.created_at.replace(' ', 'T')}Z`).getTime()) / 1000
    : Infinity;

  if (secondsSince < VERIFY_RESEND_SECONDS) {
    throw new ApiError(429, 'RESEND_TOO_SOON', 'Espera un momento antes de pedir otro código.');
  }

  await issueEmailVerification(user.id, user.email, req.ip);
  logAudit(user.id, 'auth.resend_verification', {}, req.ip);
  res.json({ ok: true, message: 'Enviamos un nuevo código a tu correo.' });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.eton_refresh as string | undefined;
  if (!token) throw unauthorized('No hay sesión activa.');
  const rotated = rotateRefreshToken(token, req);
  if (!rotated) {
    clearRefreshCookie(res);
    throw unauthorized('La sesión expiró. Inicia sesión nuevamente.');
  }
  setRefreshCookie(res, rotated.refresh);
  res.json({ accessToken: rotated.access, user: publicUser(rotated.user.id, true) });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies?.eton_refresh as string | undefined;
  if (token) revokeSession(token);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

authRouter.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  revokeAllSessions(req.user!.id);
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user!.id, true) });
}));

authRouter.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const data = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo.').optional(),
    university: z.string().trim().max(160).nullable().optional(),
    universityId: z.string().trim().max(40).nullable().optional(),
    campusId: z.string().trim().max(80).nullable().optional(),
    universityType: z.enum(['publica', 'privada']).nullable().optional(),
    faculty: z.string().trim().max(120).nullable().optional(),
    career: z.string().trim().max(160).nullable().optional(),
    coverUrl: z.string().trim().max(300).nullable().optional(),
    links: z.array(z.object({ label: z.string().max(60), url: z.string().url().max(300) })).max(8).optional(),
    country: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).nullable().optional(),
    cycle: z.string().trim().max(40).nullable().optional(),
    bio: z.string().trim().max(500).nullable().optional(),
    theme: z.enum(['dark', 'light']).optional(),
    interests: z.array(z.string().max(40)).max(12).optional(),
    onboarded: z.boolean().optional(),
    privacy: z.object({
      profile: z.enum(['community', 'friends', 'private']).optional(),
      activity: z.enum(['friends', 'private']).optional(),
    }).optional(),
    privacyFields: z.record(z.enum(['everyone', 'friends', 'private'])).optional(),
  }).parse(req.body);

  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, string> = {
    name: 'name', university: 'university', universityId: 'university_id', campusId: 'campus_id',
    universityType: 'university_type', faculty: 'faculty', career: 'career', coverUrl: 'cover_url',
    country: 'country', city: 'city', cycle: 'cycle', bio: 'bio', theme: 'theme',
  };
  for (const [key, column] of Object.entries(map)) {
    if (data[key as keyof typeof data] !== undefined) {
      fields.push(`${column} = ?`);
      values.push(data[key as keyof typeof data]);
    }
  }
  if (data.username !== undefined) {
    const normalized = slug(data.username);
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(normalized, req.user!.id);
    if (taken) throw conflict('Ese nombre de usuario ya está en uso.');
    fields.push('username = ?'); values.push(normalized);
  }
  if (data.onboarded !== undefined) { fields.push('onboarded = ?'); values.push(data.onboarded ? 1 : 0); }
  if (data.privacy !== undefined) { fields.push('privacy = ?'); values.push(JSON.stringify(data.privacy)); }
  if (data.privacyFields !== undefined) { fields.push('privacy_fields = ?'); values.push(JSON.stringify(data.privacyFields)); }
  if (data.links !== undefined) { fields.push('links = ?'); values.push(JSON.stringify(data.links)); }
  if (fields.length) {
    fields.push('updated_at = datetime(\'now\')');
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, req.user!.id);
  }
  if (data.interests) {
    const valid = db.prepare('SELECT slug FROM legal_areas').all().map((r: any) => r.slug);
    const del = db.prepare('DELETE FROM user_interests WHERE user_id = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO user_interests (user_id, area) VALUES (?, ?)');
    tx(() => {
      del.run(req.user!.id);
      for (const area of data.interests!) if (valid.includes(area)) ins.run(req.user!.id, area);
    });
  }
  res.json({ user: publicUser(req.user!.id, true) });
}));

authRouter.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const data = z.object({ current: z.string().min(1), next: passwordSchema }).parse(req.body);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
  if (!bcrypt.compareSync(data.current, row.password_hash)) throw badRequest('La contraseña actual no es correcta.');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(bcrypt.hashSync(data.next, 11), req.user!.id);
  revokeAllSessions(req.user!.id);
  logAudit(req.user!.id, 'auth.change_password', {}, req.ip);
  clearRefreshCookie(res);
  res.json({ ok: true, message: 'Contraseña actualizada. Vuelve a iniciar sesión.' });
}));

authRouter.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT id, user_agent, ip, created_at, expires_at FROM sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `).all(req.user!.id);
  res.json({ sessions: rows });
}));
