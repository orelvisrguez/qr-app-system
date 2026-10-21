# Timbre Inteligente por QR — Especificación

## 1. Objetivo
App web (PWA) que reemplaza un timbre inteligente comercial. Un visitante escanea un QR pegado en la puerta del departamento, toca un botón y el residente recibe un aviso inmediato en el celular. Sin hardware, sin mensualidades altas, sin que el visitante instale nada.

**Principios:** costo cercano a cero, simple, rápido (aviso en menos de 3 segundos), privado.

## 2. Alcance
### MVP (Fase 1)
- Página pública del visitante (`/t/:slug`).
- Panel del residente con login.
- Notificación push (PWA) y aviso por Telegram.
- Respuestas rápidas del residente que el visitante ve en pantalla.
- Historial de timbres.
- Modo No molestar.
- Generador de QR imprimible.
- Protección antispam.

### Fase 2 (después)
- Foto opcional del visitante.
- Llamada de audio/video (WebRTC).
- Varias puertas y varios residentes (familia/consorcio).
- Código de acceso temporal para huéspedes.

### Fuera de alcance
- Abrir cerraduras o portero eléctrico.
- Integración con hardware.

## 3. Usuarios
- **Visitante:** anónimo, sin cuenta, usa el navegador del celular.
- **Residente:** autenticado, administra su puerta.

## 4. Stack recomendado
- **Frontend:** React + Vite + TypeScript + Tailwind, PWA con service worker.
- **Backend:** Supabase (Postgres, Auth, Realtime, Edge Functions).
- **Push:** Web Push con claves VAPID (librería `web-push`).
- **Telegram:** bot creado con @BotFather (API HTTP, webhook a una Edge Function).
- **Antispam:** Cloudflare Turnstile (gratis, invisible).
- **QR:** librería `qrcode` en el cliente.
- **Hosting:** Lovable / Vercel / Netlify (plan gratuito).

## 5. Flujos
### 5.1 Visitante
1. Escanea el QR y abre `/t/:slug`.
2. Ve un botón grande **"Tocar timbre"**, un campo opcional **"¿Quién sos?"** y chips de motivo: *Visita, Delivery, Paquete/Correo, Otro*.
3. Toca el botón. Se valida Turnstile y los límites de uso, y se llama a la función `ring`.
4. Ve el estado **"Avisando…"**. Cuando el residente responde, aparece el mensaje (ej. *"Ya bajo"*).
5. Si el residente no responde en 60 segundos, aparece **"No hubo respuesta. Podés volver a intentar."**

### 5.2 Residente
1. Recibe la notificación push y/o el mensaje de Telegram con nombre, motivo y hora.
2. Responde con un toque: *"Ya bajo"*, *"Esperá un momento"*, *"No estoy, dejá el paquete"*, *"No esperaba a nadie"*.
3. La respuesta se guarda y llega al visitante en tiempo real.
4. Puede responder desde la app o desde los botones del bot de Telegram.

## 6. Pantallas
**Públicas**
- `/t/:slug` — Timbre del visitante (estados: inicial, enviando, avisado, respondido, sin respuesta, bloqueado por límite, puerta inactiva).

**Residente**
- `/login` — Magic link por email (Supabase Auth).
- `/panel` — Timbres recientes y estado de notificaciones.
- `/panel/historial` — Lista con fecha, nombre, motivo y respuesta.
- `/panel/ajustes` — Activar push, vincular Telegram, No molestar (horario), respuestas rápidas personalizables, regenerar slug.
- `/panel/qr` — Vista previa del QR, descarga PNG/SVG y hoja imprimible A6/A5 con el texto *"Escaneá para tocar el timbre"*.

## 7. Modelo de datos (Postgres)
```
profiles
  id uuid pk (= auth.users.id)
  telegram_chat_id text null
  created_at timestamptz

doors
  id uuid pk
  owner_id uuid fk profiles
  name text            -- uso interno, nunca se muestra al público
  slug text unique     -- 10 caracteres aleatorios
  active boolean default true
  dnd_enabled boolean default false
  dnd_start time null
  dnd_end time null
  quick_replies jsonb  -- lista de textos
  created_at timestamptz

push_subscriptions
  id uuid pk
  profile_id uuid fk
  endpoint text unique
  p256dh text
  auth text
  user_agent text
  created_at timestamptz

ring_events
  id uuid pk           -- no adivinable, sirve como token del visitante
  door_id uuid fk
  visitor_name text null
  reason text null
  status text          -- pending | answered | expired
  response_text text null
  created_at timestamptz
  responded_at timestamptz null
  ip_hash text
  device_hash text
```

**RLS:**
- El residente solo lee y escribe filas de sus propias puertas, eventos y suscripciones.
- El acceso público pasa únicamente por Edge Functions (service role), nunca directo a tablas.
- El visitante solo puede leer el estado de su propio `ring_events.id`.

## 8. Edge Functions
- **`get-door-public(slug)`** → devuelve solo `{active, quick_reasons}`. Nunca datos personales.
- **`ring`** (pública)
  - Valida Turnstile.
  - Valida rate limit: máx. 1 toque cada 30 s por dispositivo y 5 por hora por IP.
  - Valida puerta activa; si está en No molestar, igual guarda el evento pero sin push sonoro.
  - Inserta `ring_events`, envía push a todas las suscripciones y mensaje a Telegram con botones inline.
  - Devuelve `event_id`.
- **`respond`** (autenticada) → actualiza `status`, `response_text`, `responded_at`.
- **`telegram-webhook`** → procesa los botones de respuesta rápida y vinculación (`/start <código>`).
- **`cleanup`** (cron diario) → borra eventos de más de 30 días y suscripciones push inválidas.

## 9. Notificaciones
- **Web Push:** service worker con evento `push` que muestra notificación con `requireInteraction: true` y acciones (las respuestas rápidas). Al tocar, abre `/panel`.
- **iPhone:** las notificaciones solo funcionan con la PWA instalada en pantalla de inicio (iOS 16.4+). La pantalla de ajustes debe incluir una guía de instalación con capturas.
- **Telegram:** mensaje con texto *"🔔 Timbre — {nombre} ({motivo})"* y botones inline con las respuestas rápidas. Recomendado como canal principal por su confiabilidad.
- **Visitante:** recibe la respuesta por Supabase Realtime (suscripción al `event_id`) con polling cada 3 s como respaldo.

## 10. Seguridad y privacidad
- Slug aleatorio de 10 caracteres, regenerable (invalida el QR anterior).
- La página pública no muestra nombre, dirección ni número de departamento.
- IP y dispositivo se guardan solo como hash con sal secreta.
- Validar y sanitizar `visitor_name` (máx. 40 caracteres) y `reason` (lista cerrada).
- HTTPS obligatorio, CORS restringido al dominio de la app.
- Retención de datos: 30 días (configurable).
- Claves VAPID, token de Telegram y secret de Turnstile solo en variables de entorno del servidor.

## 11. Requisitos no funcionales
- Página del visitante liviana (menos de 150 KB), carga menor a 1.5 s en 4G.
- Mobile-first, accesible (botón grande, buen contraste, `aria-labels`).
- Idioma: español (Argentina). Zona horaria `America/Argentina/Buenos_Aires`.
- Funciona sin que el visitante tenga cuenta ni instale nada.

## 12. Costos estimados
- Supabase, Cloudflare Turnstile, Web Push, Telegram: plan gratuito.
- Hosting: plan gratuito.
- Dominio propio (opcional, recomendado para que el QR no cambie): costo anual bajo.
- Impresión del QR plastificado o en vinilo.

## 13. Criterios de aceptación (MVP)
- [ ] Escanear el QR abre la página del timbre sin pedir login.
- [ ] Al tocar el botón, el residente recibe push y/o Telegram en menos de 5 s.
- [ ] El residente responde con un toque y el visitante ve la respuesta en menos de 3 s.
- [ ] Un mismo dispositivo no puede tocar más de una vez cada 30 s.
- [ ] Regenerar el slug invalida el QR anterior.
- [ ] No Molestar suprime la notificación sonora dentro del horario configurado.
- [ ] La página pública no expone datos personales.
- [ ] El historial muestra los últimos 30 días.

## 14. Orden de construcción sugerido
1. Proyecto base, Supabase, tablas y RLS.
2. Login del residente y panel vacío.
3. Página del visitante + función `ring` (sin notificaciones, solo se ve en el panel).
4. Realtime de respuestas al visitante.
5. Bot de Telegram (aviso + botones de respuesta).
6. Web Push + PWA + guía de instalación para iPhone.
7. Antispam (Turnstile + rate limit).
8. Generador de QR e impresión.
9. Modo No Molestar, limpieza automática y pulido.

## 15. Prompt inicial sugerido para el agente
> Construí la app descrita en este documento siguiendo el orden de la sección 14. Usá React + Vite + TypeScript + Tailwind y Supabase. Empezá por los pasos 1 a 4 y dejá la app funcionando de punta a punta (visitante toca → residente ve y responde → visitante ve la respuesta) antes de agregar Telegram y Web Push. Todos los textos en español rioplatense.
