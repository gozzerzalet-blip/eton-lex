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
export async function sendPasswordResetCode(to, code) {
    const mailer = getTransport();
    const name = to.split('@')[0] || 'estudiante';
    try {
        await mailer.sendMail({
            from: config.smtp.from,
            to,
            subject: 'ETON LEX · Código para recuperar tu contraseña',
            text: [
                `Hola ${name},`,
                '',
                'Recibimos una solicitud para recuperar el acceso a tu cuenta de ETON LEX.',
                '',
                `Tu código es: ${code}`,
                '',
                'Válido por 15 minutos. Si no fuiste tú, ignora este correo: tu contraseña seguirá igual.',
                '',
                'ETON LEX · El Derecho, siempre a tu alcance.',
            ].join('\n'),
            html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222">
        <p>Hola ${name},</p>
        <p>Recibimos una solicitud para recuperar el acceso a tu cuenta de ETON LEX.</p>
        <p style="font-size:26px;font-weight:700;letter-spacing:6px;margin:22px 0">${code}</p>
        <p>Ese código es válido por <strong>15 minutos</strong> y sirve para elegir una nueva contraseña.</p>
        <p>Si no fuiste tú, ignora este correo: tu contraseña seguirá igual.</p>
        <p style="font-size:12px;color:#777">ETON LEX · El Derecho, siempre a tu alcance.</p>
      </div>`,
        });
    }
    catch (err) {
        console.error('[mail] no se pudo entregar el código de recuperación:', err.message);
        throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'No se pudo entregar el correo. Revisa la dirección e inténtalo nuevamente en unos minutos.');
    }
}
//# sourceMappingURL=mailer.js.map