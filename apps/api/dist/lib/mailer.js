import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { ApiError } from './http.js';
let transport = null;
function getTransport() {
    if (!config.smtp.configured) {
        throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'El correo de la plataforma todavía no está configurado. Inténtalo más tarde.');
    }
    if (!transport) {
        transport = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure,
            auth: { user: config.smtp.user, pass: config.smtp.pass },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 15_000,
        });
    }
    return transport;
}
/**
 * Envía el código real al correo de la cuenta. El código NO se devuelve en la
 * respuesta ni se escribe en logs: solo existe en el correo y su hash en la BD.
 */
async function deliverCode(to, code, email) {
    const mailer = getTransport();
    const name = to.split('@')[0] || 'estudiante';
    try {
        await mailer.sendMail({
            from: config.smtp.from,
            to,
            subject: email.subject,
            text: [
                `Hola ${name},`,
                '',
                email.intro,
                '',
                `Tu código es: ${code}`,
                '',
                `Válido por 15 minutos. ${email.ignoreNote}`,
                '',
                'ETON LEX · El Derecho, siempre a tu alcance.',
            ].join('\n'),
            html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222">
        <p>Hola ${name},</p>
        <p>${email.intro}</p>
        <p style="font-size:26px;font-weight:700;letter-spacing:6px;margin:22px 0">${code}</p>
        <p>Ese código es válido por <strong>15 minutos</strong>. ${email.after}</p>
        <p>${email.ignoreNote}</p>
        <p style="font-size:12px;color:#777">ETON LEX · El Derecho, siempre a tu alcance.</p>
      </div>`,
        });
    }
    catch (err) {
        console.error(`[mail] no se pudo entregar ${email.logLabel}:`, err.message);
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'No se pudo entregar el correo. Revisa la dirección e inténtalo nuevamente en unos minutos.');
    }
}
export async function sendPasswordResetCode(to, code) {
    await deliverCode(to, code, {
        subject: 'ETON LEX · Código para recuperar tu contraseña',
        intro: 'Recibimos una solicitud para recuperar el acceso a tu cuenta de ETON LEX.',
        after: 'Sirve para elegir una nueva contraseña.',
        ignoreNote: 'Si no fuiste tú, ignora este correo: tu contraseña seguirá igual.',
        logLabel: 'el código de recuperación',
    });
}
export async function sendEmailVerificationCode(to, code) {
    await deliverCode(to, code, {
        subject: 'ETON LEX · Verifica tu correo',
        intro: 'Creaste una cuenta en ETON LEX. Confirma tu correo para terminar el registro.',
        after: 'Colócalo en la página de ETON LEX para confirmar tu cuenta.',
        ignoreNote: 'Si no fuiste tú, ignora este correo.',
        logLabel: 'el código de verificación de registro',
    });
}
export async function sendLoginCode(to, code) {
    await deliverCode(to, code, {
        subject: 'ETON LEX · Código para ingresar',
        intro: 'Pediste ingresar a ETON LEX con un código enviado a tu correo.',
        after: 'Colócalo en la página de ETON LEX para entrar sin contraseña.',
        ignoreNote: 'Si no fuiste tú, ignora este correo: tu cuenta sigue segura.',
        logLabel: 'el código de ingreso',
    });
}
//# sourceMappingURL=mailer.js.map