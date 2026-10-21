import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'

const operator = 'Mi Timbre App'
const contactEmail = 'orelvis.rguez@gmail.com'
const lastUpdated = '21 de octubre de 2026'

function Logo() {
  return <span className="logo-lockup"><span className="logo-icon"><Bell size={19} fill="currentColor" /></span><span className="logo-word">timbre<span>.</span></span></span>
}

export function LegalPage({ type }: { type: 'privacy' | 'terms' }) {
  const isPrivacy = type === 'privacy'

  return (
    <main className="legal-page">
      <header className="public-header legal-header">
        <Link to="/" className="brand"><Logo /></Link>
        <nav><Link to="/login">Acceso de residentes</Link></nav>
      </header>
      <article className="legal-content">
        <Link className="legal-back" to="/">← Volver a Timbre</Link>
        <span className="eyebrow">{operator.toUpperCase()}</span>
        <h1>{isPrivacy ? 'Política de privacidad' : 'Condiciones del servicio'}</h1>
        <p className="legal-updated">Última actualización: {lastUpdated}</p>

        {isPrivacy ? <PrivacyPolicy /> : <TermsOfService />}

        <section className="legal-contact">
          <h2>Contacto</h2>
          <p>Para consultas sobre el servicio o solicitudes relacionadas con tus datos personales, escribinos a <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
        </section>
        <footer className="legal-footer">
          <Link to="/privacidad">Privacidad</Link>
          <Link to="/condiciones">Condiciones</Link>
          <Link to="/">Inicio</Link>
        </footer>
      </article>
    </main>
  )
}

function PrivacyPolicy() {
  return (
    <>
      <p><strong>Mi Timbre App</strong> ofrece Timbre QR, un servicio web que permite que una visita envíe un aviso al residente mediante un código QR. Esta política explica qué información se usa y con qué finalidad.</p>

      <section>
        <h2>Información que tratamos</h2>
        <ul>
          <li><strong>Cuenta del residente:</strong> correo electrónico e información básica del perfil que proporciona el proveedor de acceso, como nombre o imagen si están disponibles. Si iniciás sesión con Google, Timbre solicita únicamente los permisos básicos de identidad (correo y perfil); no accede a Gmail, Drive ni a tus contactos.</li>
          <li><strong>Configuración del timbre:</strong> enlace QR, estado activo, horarios de No molestar y respuestas rápidas.</li>
          <li><strong>Avisos de visitantes:</strong> nombre opcional, motivo, fecha y hora, estado del aviso y respuesta del residente.</li>
          <li><strong>Prevención de abuso:</strong> la dirección IP y un identificador del dispositivo se transforman en hashes para aplicar límites de uso; la tabla de avisos no guarda esos valores originales.</li>
          <li><strong>Telegram opcional:</strong> si vinculás el bot, guardamos el identificador del chat y enviamos allí el nombre opcional del visitante, el motivo y la hora del aviso para que puedas responder desde Telegram.</li>
          <li><strong>Notificaciones web opcionales:</strong> si las activás, guardamos la suscripción de este navegador (endpoint y claves técnicas) para enviar avisos push. Podés desactivarlas desde Ajustes; el permiso también se administra en tu navegador.</li>
          <li><strong>Datos técnicos:</strong> el navegador puede almacenar la sesión de acceso y recursos necesarios para la PWA y su funcionamiento sin conexión.</li>
        </ul>
      </section>

      <section>
        <h2>Para qué usamos la información</h2>
        <p>Usamos estos datos para autenticar residentes, administrar el timbre, entregar y responder avisos, proteger el servicio contra abuso, mantener la sesión y atender consultas. No vendemos datos personales ni usamos los datos del perfil de Google para publicidad.</p>
      </section>

      <section>
        <h2>Servicios que intervienen</h2>
        <p>El servicio utiliza proveedores para operar: Supabase (autenticación y base de datos), Vercel (alojamiento web), Google (si elegís iniciar sesión con Google), Cloudflare Turnstile (prevención de abuso), Telegram (solo si vinculás ese canal) y el servicio push de tu navegador o dispositivo (solo si activás las notificaciones web). Estos proveedores reciben la información necesaria para prestar su función y la procesan conforme a sus propias políticas. La infraestructura puede procesar o almacenar datos en países distintos al tuyo.</p>
      </section>

      <section>
        <h2>Conservación y eliminación</h2>
        <p>Los avisos se muestran en el historial de los últimos 30 días y el sistema dispone de una función para limpiar avisos más antiguos. La eliminación efectiva depende de que las tareas de mantenimiento estén habilitadas; copias técnicas de respaldo pueden conservar datos por los plazos propios del proveedor. Los datos de la cuenta y la configuración se conservan mientras la cuenta esté activa, salvo que solicites su eliminación.</p>
        <p>Podés desconectar Telegram desde Ajustes. Para solicitar acceso, corrección o eliminación de datos de tu cuenta, escribinos al contacto indicado al final de esta página. La solicitud puede requerir verificar que sos titular de la cuenta.</p>
      </section>

      <section>
        <h2>Seguridad y cambios</h2>
        <p>Aplicamos controles de acceso y políticas de base de datos para limitar el acceso a la información de cada residente. Ningún sistema conectado a Internet puede garantizar seguridad absoluta. Podemos actualizar esta política cuando cambien el servicio o sus requisitos; publicaremos la versión vigente en esta página.</p>
      </section>
    </>
  )
}

function TermsOfService() {
  return (
    <>
      <p>Estas condiciones regulan el uso de Timbre QR, operado por <strong>Mi Timbre App</strong>. Al crear una cuenta o utilizar el servicio, aceptás estas condiciones y la <Link to="/privacidad">Política de privacidad</Link>.</p>

      <section>
        <h2>Qué ofrece el servicio</h2>
        <p>Timbre QR permite crear un enlace o código QR para que las visitas envíen avisos al residente. El residente puede administrar el timbre, consultar avisos recientes y responder desde el panel o, si lo vincula, mediante Telegram. El servicio puede modificarse, interrumpirse o incorporar funciones nuevas.</p>
      </section>

      <section>
        <h2>Cuenta y uso responsable</h2>
        <p>Debés usar una cuenta que controles y proteger el acceso a ella. Sos responsable de dónde compartís o exhibís tu QR y de mantener apropiadas tus respuestas y configuraciones. No uses el servicio para actividades ilegales, hostigamiento, suplantación, spam, recopilación no autorizada de datos ni para intentar interferir con su seguridad o disponibilidad.</p>
        <p>Los datos de visitantes deben limitarse a lo necesario para identificar el aviso. No incluyas información sensible en nombres o respuestas rápidas.</p>
      </section>

      <section>
        <h2>Avisos y notificaciones</h2>
        <p>El QR facilita la comunicación, pero no es un sistema de emergencia ni garantiza que el residente reciba, lea o responda un aviso. La entrega depende de la conexión, la disponibilidad de Timbre QR, la configuración del navegador y de terceros como Supabase, Vercel, Cloudflare, Telegram y los servicios push del dispositivo. No uses el servicio para comunicaciones urgentes o de seguridad crítica.</p>
      </section>

      <section>
        <h2>Disponibilidad y responsabilidad</h2>
        <p>El servicio se ofrece sin garantía de disponibilidad continua o de ausencia de errores. En la medida permitida por la normativa aplicable, Mi Timbre App no será responsable por fallos o demoras de proveedores externos, conectividad, pérdida de avisos, uso no autorizado de un QR compartido públicamente o daños indirectos derivados del uso del servicio. Nada de estas condiciones limita derechos que no puedan excluirse legalmente.</p>
      </section>

      <section>
        <h2>Suspensión y cambios</h2>
        <p>Podemos limitar o suspender el acceso cuando sea necesario para proteger el servicio, a sus usuarios o para cumplir la ley, especialmente ante un uso abusivo o contrario a estas condiciones. Las condiciones pueden actualizarse; la versión vigente y su fecha de actualización estarán publicadas aquí. Si seguís usando el servicio tras un cambio, se aplicarán las condiciones actualizadas, sin afectar derechos irrenunciables.</p>
      </section>

    </>
  )
}
