# Timbre QR

PWA mobile-first para que una visita avise al residente desde un QR. Incluye la página pública, acceso con enlace mágico, panel e historial de 30 días, respuestas rápidas, No molestar, generación del QR y las funciones seguras para crear y consultar avisos.

El acceso de residentes permite Google OAuth y enlace mágico por correo. Las páginas públicas de [privacidad](/privacidad) y [condiciones](/condiciones) están disponibles para usuarios y revisión de OAuth.

## Desarrollo

1. Crear un proyecto en Supabase y aplicar `supabase/migrations/202610210001_initial_schema.sql`.
2. Copiar `.env.example` a `.env.local` y completar la URL, la clave anon de Supabase y la clave pública del sitio de Turnstile.
3. Instalar y arrancar:

   ```sh
   npm install
   npm run dev
   ```

4. En Supabase, agregar `http://localhost:5173/panel` a las URL de redirección permitidas de Auth.
5. Configurar y desplegar las funciones `get-door-public`, `ring`, `get-event-status`, `telegram-link-code`, `telegram-webhook` y `push-subscription`:

   ```sh
   supabase functions deploy get-door-public
   supabase functions deploy ring
   supabase functions deploy get-event-status
   supabase functions deploy telegram-link-code
   supabase functions deploy telegram-webhook
   supabase functions deploy push-subscription
   ```

   Para desarrollo local, agregar los orígenes permitidos a `CORS_ALLOWED_ORIGINS` (separados por comas). `ring` necesita `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES`, `HASH_SALT`, `TELEGRAM_BOT_TOKEN` y las claves VAPID `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`; `telegram-link-code` necesita `SUPABASE_ANON_KEY`, `HASH_SALT` y `TELEGRAM_BOT_USERNAME`; `telegram-webhook` necesita `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` y `HASH_SALT`. Las funciones también necesitan `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. La clave pública VAPID va en `VITE_VAPID_PUBLIC_KEY` para el frontend; mantené la clave privada únicamente en secretos de Supabase. Nunca uses la clave service role ni los secretos de Turnstile, Telegram, VAPID privado o hash en variables `VITE_*`.
6. Configurá el webhook del bot con `https://<proyecto>.supabase.co/functions/v1/telegram-webhook`, el mismo `TELEGRAM_WEBHOOK_SECRET` como secreto del webhook de Telegram y las actualizaciones `message` y `callback_query`. El nombre del bot se configura sin `@` en `TELEGRAM_BOT_USERNAME`.
7. En producción, reemplazar el origen local por el dominio HTTPS de la app y agregar ese dominio a las URL permitidas de Supabase Auth y a Turnstile.

### Workspace conectado por CLI

En este workspace el proyecto `mtaarwgdeatipdmarxkh` ya está vinculado con Supabase CLI. La migración inicial está aplicada y las Edge Functions están desplegadas, incluida `push-subscription`; `.env.local` contiene la URL y claves públicas para Vite y está excluido de Git. El secreto `CORS_ALLOWED_ORIGINS` permite `https://tutimbre.vercel.app`, `http://localhost:5173` y `http://127.0.0.1:5173`.

Google OAuth debe estar habilitado como proveedor en Supabase. En el cliente OAuth de Google, agregá como URI de redirección autorizada `https://mtaarwgdeatipdmarxkh.supabase.co/auth/v1/callback`. En la lista de redirecciones permitidas de Supabase Auth, incluí `https://tutimbre.vercel.app/panel`, además de las URLs locales de desarrollo. El Client ID y el Client Secret de Google se cargan únicamente en la configuración del proveedor Google en Supabase; nunca los guardes en variables `VITE_*` ni en Git. En este workspace, Turnstile está configurado localmente y sus secretos de servidor están guardados en Supabase. Telegram está configurado con el bot `@MiTimbreAppBot` y el webhook apunta a la función `telegram-webhook`; sus credenciales y el secreto del webhook solo están guardados en Supabase. Ningún secreto de servidor debe guardarse en variables `VITE_*`.

El SMTP integrado de Supabase es solo para pruebas y tiene un límite bajo de envíos; si aparece `email rate limit exceeded`, esperá a que se restablezca o configurá un proveedor SMTP propio en [Auth > SMTP Settings](https://supabase.com/dashboard/project/mtaarwgdeatipdmarxkh/auth/smtp). Para uso público, verificá también el dominio remitente con tu proveedor.

Al autenticar una cuenta nueva, la migración crea su perfil y una puerta con slug aleatorio. El visitante nunca accede directamente a las tablas: el timbre y la consulta de respuesta pasan por funciones Edge; el estado público se consulta con un UUID impredecible. Los eventos conservan hashes HMAC de IP y dispositivo, no sus valores originales.

## PWA y funcionalidades

El widget Turnstile existente usa la acción `door_ring`. La función `ring` valida el token en `siteverify`, exige esa acción y comprueba el hostname contra `TURNSTILE_HOSTNAMES`. En producción, este secreto contiene solo los hostnames productivos aprobados; no agregues `localhost` ni `127.0.0.1` al allowlist de hostname del backend productivo. La site key es pública y se configura como `VITE_TURNSTILE_SITE_KEY`; el secreto vive únicamente en Edge Function Secrets.

El service worker proporciona el shell instalable y conserva recursos visitados para navegación de respaldo sin conexión. La interacción de avisos usa polling cada 3 segundos, con vencimiento a los 60 segundos. En el panel residente, Supabase Realtime actualiza los avisos.

En Vercel, `vercel.json` reescribe las rutas de React Router a `index.html` para que URLs como `/login` y `/t/<slug>` funcionen también al abrirlas directamente.

Los avisos se envían a Telegram cuando hay un chat vinculado y como Web Push a los navegadores que activaron las notificaciones desde Ajustes. La persona residente debe aceptar el permiso del navegador en cada dispositivo. Los botones de Telegram responden al visitante con un toque. Durante No molestar el aviso push se marca como silencioso y Telegram lo entrega sin sonido. Web Push requiere HTTPS (excepto localhost), soporte del navegador y configuración VAPID. En iPhone/iPad, la PWA debe instalarse en la pantalla de inicio y el sistema debe admitir notificaciones web. La verificación Turnstile es obligatoria para crear avisos. Para depurar localmente, crear una clave Turnstile de prueba desde Cloudflare.

`cleanup_old_ring_events()` elimina avisos de más de 30 días. Programá su ejecución diaria desde Supabase Cron llamando la función con privilegios de servicio.
