import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Logo } from '../components/Logo';

type Section = { title: string; body: string[] };

const UPDATED = '14 de noviembre de 2026';

function PageShell({
  eyebrow,
  title,
  intro,
  sections,
  footer,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: Section[];
  footer?: ReactNode;
}) {
  return (
    <div className="relative z-10 min-h-screen">
      <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-6 sm:px-8">
        <Link to="/login" aria-label="ETON LEX — ir al acceso">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn btn-sm btn-ghost">
            Ingresar
          </Link>
          <Link to="/registro" className="btn btn-sm btn-primary">
            Crear cuenta <ArrowRight size={13} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-20 sm:px-8">
        <p className="text-[10px] uppercase tracking-[0.26em] text-fg/35">{eyebrow}</p>
        <h1 className="mt-3 font-display text-[34px] leading-tight tracking-[-0.01em] text-fg/95 sm:text-[42px]">{title}</h1>
        <div className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-fg/50">{intro}</div>
        <p className="mt-3 text-[11px] text-fg/30">Última actualización: {UPDATED}</p>

        <div className="mt-8 space-y-4">
          {sections.map((section) => (
            <section key={section.title} className="card p-5 sm:p-6">
              <h2 className="font-display text-[17px] text-fg/90">{section.title}</h2>
              <div className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-fg/55">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {footer && <div className="mt-6">{footer}</div>}

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Link to="/login" className="btn btn-sm">
            <ArrowLeft size={13} /> Volver al acceso
          </Link>
          <Link to="/acerca" className="btn btn-sm btn-ghost">Acerca de ETON LEX</Link>
          <Link to="/privacidad" className="btn btn-sm btn-ghost">Privacidad</Link>
          <Link to="/terminos" className="btn btn-sm btn-ghost">Términos</Link>
        </div>

        <p className="mt-10 text-[10px] uppercase tracking-[0.22em] text-fg/20">
          ETON LEX · Creado por Zalet Gozzer · El Derecho, siempre a tu alcance
        </p>
      </main>
    </div>
  );
}

export function AboutPage() {
  return (
    <PageShell
      eyebrow="Acerca del proyecto"
      title="ETON LEX"
      intro={
        <p>
          Una plataforma jurídica creada para estudiantes de Derecho del Perú. Reúne legislación con
          enlace a su fuente oficial, un asistente que cita lo que puede verificar y una comunidad
          académica privada, sin sustituir el estudio ni la asesoría legal profesional.
        </p>
      }
      sections={[
        {
          title: 'Qué ofrece',
          body: [
            'Biblioteca normativa con metadatos de normas peruanas y enlace a la fuente oficial (SPIJ o El Peruano). Cuando el texto articulado no se ha cargado desde una fuente oficial, la plataforma lo indica como «texto pendiente» en lugar de inventarlo.',
            'ETON AI responde sobre el corpus disponible y cita norma, artículo y fuente. Si no puede confirmar un dato, lo dice expresamente y no genera respuestas simuladas.',
            'Noticias legislativas, actualizaciones normativas, comunidad de estudio y mensajería. La aplicación puede instalarse como PWA en el teléfono o la computadora.',
          ],
        },
        {
          title: 'Creadora',
          body: [
            'ETON LEX fue concebida y dirigida por Zalet Gozzer, creadora y responsable del proyecto, la marca y el software.',
            'La identidad visual —templo clásico con libro abierto— y la estética monocromática forman parte de esa identidad de marca.',
          ],
        },
        {
          title: 'Compromiso con la información verificable',
          body: [
            'La plataforma distingue entre metadatos verificados, texto pendiente de carga y contenido aportado por la comunidad. No presenta datos simulados como si fueran reales.',
            'Los módulos que dependen de servicios externos (proveedor de IA, feeds de noticias, correo o TURN para llamadas) muestran su estado real como «no configurado» cuando falta esa configuración.',
            'Toda cita jurídica debe contrastarse siempre con la fuente oficial vigente antes de usarse en un trabajo académico o escrito judicial.',
          ],
        },
        {
          title: 'Privacidad por diseño',
          body: [
            'Las conversaciones, perfiles, mensajes y datos personales no se publican en buscadores: las rutas privadas requieren sesión y están excluidas de la indexación.',
            'La visibilidad del perfil y de la actividad se controla desde Configuración → Privacidad.',
          ],
        },
        {
          title: 'Estado del proyecto',
          body: [
            'Funciones operativas: registro e inicio de sesión, biblioteca, comunidad, mensajería, actualizaciones, panel administrativo y PWA.',
            'Pendiente de configuración del responsable: proveedor de ETON AI, feeds de noticias, SMTP para verificación de correo y TURN para llamadas en redes estrictas.',
            'Pendiente de publicación: dominio oficial con HTTPS, Google Search Console y las tiendas de aplicaciones.',
          ],
        },
      ]}
      footer={
        <p className="card p-5 text-[12px] leading-relaxed text-fg/50">
          Para consultas sobre el proyecto o solicitudes de privacidad, utiliza el canal de contacto
          que se habilitará junto con el dominio oficial de ETON LEX.
        </p>
      }
    />
  );
}

export function PrivacyPage() {
  return (
    <PageShell
      eyebrow="Información legal"
      title="Política de privacidad"
      intro={
        <p>
          Esta política explica qué datos trata ETON LEX, con qué finalidad y cómo ejercer tus
          derechos conforme a la Ley N.º 29733, Ley de Protección de Datos Personales del Perú.
        </p>
      }
      sections={[
        {
          title: 'Responsable del tratamiento',
          body: [
            'Responsable: Zalet Gozzer, creadora y responsable del proyecto ETON LEX.',
            'El canal oficial de contacto para asuntos de privacidad se publicará junto con el dominio definitivo de la plataforma.',
          ],
        },
        {
          title: 'Datos que tratamos',
          body: [
            'Datos de cuenta: nombre, correo electrónico, universidad, ciclo académico, intereses y foto de perfil cuando la agregues.',
            'Actividad en la plataforma: publicaciones, comentarios, mensajes, grupos, documentos que subas y consultas realizadas a ETON AI.',
            'Datos técnicos necesarios para la seguridad del servicio: identificadores de sesión, dirección IP, fecha y tipo de dispositivo.',
          ],
        },
        {
          title: 'Finalidades',
          body: [
            'Prestar el servicio: autenticación, biblioteca, comunidad, mensajería, notificaciones y funciones de estudio.',
            'Seguridad: prevenir abuso, fraude, accesos no autorizados y ataques al servicio.',
            'Comunicaciones operativas del servicio, como verificación de correo o recuperación de acceso cuando el envío de correo esté configurado.',
          ],
        },
        {
          title: 'Base legal y límites',
          body: [
            'El tratamiento se sustenta en el consentimiento del usuario y en la ejecución de la relación de servicio, conforme a la legislación peruana.',
            'No vendemos datos personales ni los usamos para publicidad de terceros. No elaboramos perfiles comerciales.',
          ],
        },
        {
          title: 'Conservación y seguridad',
          body: [
            'Los datos se conservan mientras la cuenta esté activa o hasta que se solicite su eliminación, salvo obligaciones legales de conservación.',
            'Aplicamos medidas técnicas razonables: contraseñas almacenadas con hash, sesiones con tokens, cookies httpOnly, HTTPS en producción y acceso administrativo restringido.',
          ],
        },
        {
          title: 'Cookies y almacenamiento local',
          body: [
            'Usamos cookies necesarias para mantener la sesión y almacenamiento local para recordar el tema visual (claro u oscuro). No utilizamos cookies publicitarias ni de seguimiento de terceros.',
          ],
        },
        {
          title: 'Tus derechos',
          body: [
            'Puedes solicitar acceso, rectificación, cancelación u oposición (derechos ARCO) sobre tus datos personales.',
            'También puedes actualizar tus datos y preferencias desde Configuración → Cuenta y Configuración → Privacidad.',
            'Las solicitudes se atenderán por el canal oficial de contacto que se habilite con el dominio definitivo.',
          ],
        },
        {
          title: 'Encargados y transferencias',
          body: [
            'Cuando se configure un proveedor de inteligencia artificial, de correo o de alojamiento, solo se compartirán los datos necesarios para prestar la función correspondiente, bajo obligaciones de confidencialidad y seguridad.',
            'Las rutas privadas no se indexan en buscadores y el contenido de conversaciones y perfiles no se publica fuera de la plataforma.',
          ],
        },
        {
          title: 'Menores de edad',
          body: [
            'ETON LEX está dirigida a estudiantes de educación superior. Si eres menor de 14 años, necesitas la autorización de tu padre, madre o tutor legal para usar la plataforma.',
          ],
        },
        {
          title: 'Cambios en esta política',
          body: [
            'Podemos actualizar esta política para reflejar cambios del servicio o de la normativa. Publicaremos la versión vigente en esta página con su fecha de actualización.',
          ],
        },
      ]}
      footer={
        <p className="card p-5 text-[12px] leading-relaxed text-fg/50">
          Documento base de privacidad. Antes de la publicación comercial, el responsable debe
          completar los datos de contacto y someterlo a revisión legal.
        </p>
      }
    />
  );
}

export function TermsPage() {
  return (
    <PageShell
      eyebrow="Información legal"
      title="Términos de uso"
      intro={
        <p>
          Estos términos regulan el acceso y uso de ETON LEX. Al crear una cuenta o utilizar la
          plataforma, aceptas las condiciones descritas en esta página.
        </p>
      }
      sections={[
        {
          title: 'Objeto del servicio',
          body: [
            'ETON LEX es una plataforma educativa para estudiantes de Derecho del Perú. Ofrece biblioteca normativa, herramientas de estudio, un asistente jurídico, noticias legislativas, comunidad y mensajería.',
            'El servicio no constituye asesoría legal profesional ni reemplaza la consulta con un abogado habilitado. La información jurídica debe verificarse siempre en la fuente oficial vigente.',
          ],
        },
        {
          title: 'Cuenta y seguridad',
          body: [
            'Debes proporcionar información veraz y mantener la confidencialidad de tu contraseña. Eres responsable de la actividad realizada desde tu cuenta.',
            'Podemos suspender cuentas ante indicios de fraude, suplantación, acceso no autorizado o incumplimiento de estos términos.',
          ],
        },
        {
          title: 'Uso aceptable',
          body: [
            'No está permitido extraer masivamente datos (scraping), interferir con la seguridad del servicio, suplantar a otra persona, publicar contenido ilícito o vulnerar derechos de terceros.',
            'El contenido que compartas debe respetar la privacidad y la dignidad de las demás personas, así como los derechos de autor correspondientes.',
          ],
        },
        {
          title: 'Contenido del usuario',
          body: [
            'Conservas la titularidad de los contenidos que publicas. Otorgas a ETON LEX una licencia limitada para alojarlos, mostrarlos y moderarlos dentro de la plataforma, con la única finalidad de prestar el servicio.',
            'Eres responsable de contar con los derechos necesarios sobre los documentos y textos que subas.',
          ],
        },
        {
          title: 'Información jurídica y ETON AI',
          body: [
            'La biblioteca distingue los metadatos de las normas del texto articulado cargado desde fuentes oficiales. Cuando el texto no ha sido validado, se muestra como pendiente.',
            'ETON AI puede equivocarse. Sus respuestas no son asesoría legal y deben contrastarse con la norma y la fuente oficial antes de citarse.',
          ],
        },
        {
          title: 'Propiedad intelectual',
          body: [
            'La marca ETON LEX, el diseño, el software y los elementos de identidad visual pertenecen a su creadora, Zalet Gozzer, salvo los contenidos de dominio público o de terceros que se citen.',
            'Los textos legales oficiales pertenecen al dominio público conforme a la legislación aplicable.',
          ],
        },
        {
          title: 'Disponibilidad y cambios',
          body: [
            'El servicio puede experimentar interrupciones por mantenimiento, actualizaciones o causas ajenas. Algunas funciones dependen de servicios externos que pueden no estar configurados.',
            'Podemos modificar o retirar funciones para mejorar la plataforma, informando los cambios relevantes en la propia aplicación.',
          ],
        },
        {
          title: 'Limitación de responsabilidad',
          body: [
            'ETON LEX se ofrece «tal como está». En la medida permitida por la ley, no asumimos responsabilidad por decisiones tomadas a partir de la información de la plataforma sin la debida verificación en la fuente oficial.',
          ],
        },
        {
          title: 'Ley aplicable',
          body: [
            'Estos términos se rigen por la legislación de la República del Perú. Cualquier controversia se someterá a los tribunales competentes conforme a la normativa peruana.',
          ],
        },
      ]}
      footer={
        <p className="card p-5 text-[12px] leading-relaxed text-fg/50">
          Documento base de términos de uso. Antes de la publicación comercial, el responsable debe
          completar los datos de contacto y someterlo a revisión legal.
        </p>
      }
    />
  );
}
