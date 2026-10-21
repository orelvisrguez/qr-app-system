import { lazy, Suspense, useEffect, useState } from 'react'
import { Bell, Camera, ChevronRight, DoorOpen, Phone, ShieldCheck, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { CallSession } from './components/CallSession'

const TurnstileWidget = lazy(() => import('@marsidev/react-turnstile').then(({ Turnstile }) => ({ default: Turnstile })))
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const quickReasons = ['Visita', 'Delivery', 'Paquete/Correo', 'Otro']

async function compressVisitorPhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Elegí un archivo de imagen.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No pudimos preparar la foto.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('No pudimos procesar la foto.')), 'image/jpeg', 0.72)
  })
  if (blob.size > 2 * 1024 * 1024) throw new Error('La foto supera el tamaño máximo de 2 MB.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No pudimos leer la foto.'))
    reader.onerror = () => reject(new Error('No pudimos leer la foto.'))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

class EdgeFunctionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function invokePublicFunction(name: string, body: Record<string, unknown>) {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('El timbre todavía no está configurado.')
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error('El servidor devolvió una respuesta inválida.')
  }
  if (!response.ok) {
    const detail = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
      ? result.error
      : `HTTP ${response.status}`
    throw new EdgeFunctionError(detail, response.status)
  }
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('El servidor devolvió una respuesta inválida.')
  }
  return result as Record<string, unknown>
}

function Logo() {
  return <span className="logo-lockup"><span className="logo-icon"><Bell size={19} fill="currentColor" /></span><span className="logo-word">timbre<span>.</span></span></span>
}

export function LandingPage() {
  return (
    <main className="landing-page">
      <header className="public-header"><Link to="/" className="brand"><Logo /></Link><nav><a href="#como-funciona">Cómo funciona</a><Link className="header-login" to="/login">Soy residente <ChevronRight size={15} /></Link></nav></header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> TU PUERTA, MÁS SIMPLE</span>
          <h1>Un aviso.<br /><span>Y listo.</span></h1>
          <p className="hero-lede">Un timbre inteligente que vive en un QR. Sin aparatos, sin apps para tus visitas, sin complicaciones.</p>
          <div className="hero-actions"><Link className="button button-dark" to="/login">Configurar mi timbre <ChevronRight size={18} /></Link><a className="text-link" href="#como-funciona">¿Cómo funciona?</a></div>
          <div className="hero-proof"><ShieldCheck size={17} /> Privado por diseño <span /> Gratis para empezar</div>
        </div>
        <div className="hero-art" aria-label="Vista previa del timbre en un celular">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
          <div className="phone-mock"><div className="phone-camera" /><div className="phone-content">
            <div className="mini-top"><span className="mini-mark"><Bell size={14} /></span><span>TOC, TOC</span><span className="mini-menu">•••</span></div>
            <div className="door-circle"><DoorOpen size={34} strokeWidth={1.5} /></div><span className="phone-kicker">ESTÁS EN CASA DE</span><h2>Tu vecino</h2>
            <p>Dejá un aviso y ya le contamos que llegaste.</p><div className="phone-input">¿Quién sos? <span>Opcional</span></div>
            <div className="phone-chips"><b>Visita</b><span>Delivery</span></div><div className="phone-ring"><Bell size={19} fill="currentColor" /> Tocar timbre</div><div className="phone-foot">No hace falta instalar nada ✨</div>
          </div></div>
          <div className="notification-float"><div className="notification-icon"><Bell size={17} fill="currentColor" /></div><div><strong>Alguien llegó</strong><span>Visita · Ahora</span></div><span className="live-dot" /></div>
          <div className="safe-float"><ShieldCheck size={15} /> Tus datos, siempre privados</div><span className="hero-sparkle sparkle-a">✳</span><span className="hero-sparkle sparkle-b">✳</span>
        </div>
      </section>
      <section className="feature-strip" id="como-funciona">
        <div><span className="feature-number">01</span><div><strong>Pegá el QR</strong><p>Lo imprimís y lo ponés en tu puerta.</p></div></div>
        <div><span className="feature-number">02</span><div><strong>Te avisan al instante</strong><p>El residente recibe el aviso en su panel.</p></div></div>
        <div><span className="feature-number">03</span><div><strong>Respondé con un toque</strong><p>Tu respuesta le llega a quien te visita.</p></div></div>
      </section>
      <footer className="landing-footer"><Logo /><span>Hecho para que llegar sea más fácil.</span><div className="legal-links"><Link to="/privacidad">Privacidad</Link><Link to="/condiciones">Condiciones</Link></div><Link to="/login">Entrar a mi panel <ChevronRight size={15} /></Link></footer>
    </main>
  )
}

export function VisitorPage() {
  const { slug = '' } = useParams()
  const [doorActive, setDoorActive] = useState<boolean | null>(null)
  const [doorLoading, setDoorLoading] = useState(true)
  const [name, setName] = useState('')
  const [reason, setReason] = useState<string>('Visita')
  const [photo, setPhoto] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const [photoError, setPhotoError] = useState('')
  const [token, setToken] = useState('')
  const [widgetKey, setWidgetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [eventId, setEventId] = useState('')
  const [response, setResponse] = useState('')
  const [callId, setCallId] = useState('')
  const [callBusy, setCallBusy] = useState(false)
  const [callMessage, setCallMessage] = useState('')
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'answered' | 'expired'>('idle')

  useEffect(() => {
    let cancelled = false
    async function getDoor() {
      if (!supabaseUrl || !supabaseAnonKey) {
        setMessage('El timbre todavía no está configurado. Probá de nuevo más tarde.')
        setDoorActive(false)
        setDoorLoading(false)
        return
      }
      try {
        const data = await invokePublicFunction('get-door-public', { slug })
        if (cancelled) return
        setDoorActive(data.active === true)
      } catch (error) {
        if (!cancelled) {
          setDoorActive(false)
          setMessage(error instanceof EdgeFunctionError && error.status === 404
            ? 'El timbre está pausado o ese enlace ya no está activo.'
            : error instanceof Error ? `No pudimos verificar el timbre: ${error.message}` : 'No pudimos verificar el timbre.')
        }
      } finally {
        if (!cancelled) setDoorLoading(false)
      }
    }
    void getDoor()
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (!eventId || phase !== 'waiting') return
    let active = true
    const startedAt = Date.now()
    const poll = async () => {
      if (!active) return
      if (Date.now() - startedAt >= 60_000 && !callId) {
        setPhase('expired')
        return
      }
      try {
        const data = await invokePublicFunction('get-event-status', { event_id: eventId })
        if (!active) return
        if (data.status === 'answered' && !callId) {
          setResponse(typeof data.response_text === 'string' ? data.response_text : 'El residente recibió tu aviso.')
          setPhase('answered')
        } else if (data.status === 'expired') {
          setPhase('expired')
        } else {
          setMessage('')
        }
      } catch {
        if (!active) return
        setMessage('No pudimos actualizar el estado. Seguimos intentando…')
      }
    }
    void poll()
    const interval = window.setInterval(() => void poll(), 3000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [callId, eventId, phase])

  async function selectPhoto(file: File | undefined) {
    setPhotoError('')
    setPhoto('')
    setPhotoPreview('')
    if (!file) return
    try {
      const compressed = await compressVisitorPhoto(file)
      setPhoto(compressed)
      setPhotoPreview(`data:image/jpeg;base64,${compressed}`)
    } catch (photoProcessingError) {
      setPhotoError(photoProcessingError instanceof Error ? photoProcessingError.message : 'No pudimos preparar la foto.')
    }
  }

  async function ring() {
    if (!supabaseUrl || !supabaseAnonKey || !token || busy) return
    setBusy(true)
    setMessage('')
    const deviceKey = 'timbre-device-id'
    let deviceId = localStorage.getItem(deviceKey)
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem(deviceKey, deviceId)
    }
    try {
      const data = await invokePublicFunction('ring', {
        slug,
        visitor_name: name.trim().slice(0, 40) || null,
        reason,
        device_id: deviceId,
        turnstile_token: token,
        ...(photo ? { visitor_photo_base64: photo } : {}),
      })
      if (typeof data.event_id === 'string') {
        setEventId(data.event_id)
        setPhase('waiting')
        setResponse('')
        if (!data.notification_sent) setMessage('El aviso quedó registrado, pero no hay notificaciones activas para esta puerta. Si podés, avisá directamente en la puerta.')
        if (photo && data.photo_saved === false) setPhotoError('El aviso se envió, pero no se pudo adjuntar la foto.')
      } else {
        setMessage('No pudimos enviar el aviso. Probá de nuevo.')
      }
    } catch (error) {
      if (error instanceof EdgeFunctionError && error.status === 429) {
        setMessage('Ya tocaste hace poquito. Esperá un momento antes de volver a intentar.')
      } else if (error instanceof EdgeFunctionError && error.status === 403) {
        setMessage('No pudimos validar el desafío. Esperá a que Turnstile se actualice y probá de nuevo.')
      } else {
        setMessage(error instanceof Error ? error.message : 'No se pudo enviar el aviso.')
      }
      setToken('')
      setWidgetKey((key) => key + 1)
    } finally {
      setBusy(false)
    }
  }

  function retry() {
    setPhase('idle')
    setEventId('')
    setToken('')
    setMessage('')
    setWidgetKey((key) => key + 1)
    setCallId('')
    setCallMessage('')
  }

  async function requestCall() {
    if (!supabaseUrl || !supabaseAnonKey || !eventId || callBusy) return
    setCallBusy(true)
    setCallMessage('')
    let data: Record<string, unknown>
    try {
      data = await invokePublicFunction('door-call-signal', { action: 'request', event_id: eventId })
    } catch (requestError) {
      setCallBusy(false)
      setCallMessage(requestError instanceof Error ? requestError.message : 'No pudimos iniciar la llamada.')
      return
    }
    setCallBusy(false)
    if (typeof data.call_id === 'string') {
      setCallId(data.call_id)
    } else {
      setCallMessage('No pudimos iniciar la llamada. Probá de nuevo.')
    }
  }

  function closeCall() {
    setCallId('')
    setCallMessage('')
  }

  const unavailable = !doorLoading && doorActive === false
  if (!doorLoading && !unavailable && phase === 'idle') {
    return <VisitorFrame><VisitorStartForm
      name={name}
      onNameChange={setName}
      reason={reason}
      onReasonChange={setReason}
      photoPreview={photoPreview}
      photoError={photoError}
      onPhotoSelect={(file) => void selectPhoto(file)}
      onPhotoRemove={() => { setPhoto(''); setPhotoPreview(''); setPhotoError('') }}
      token={token}
      widgetKey={widgetKey}
      onToken={setToken}
      onError={setMessage}
      message={message}
      busy={busy}
      onRing={() => void ring()}
    /></VisitorFrame>
  }
  if (!doorLoading && !unavailable && phase === 'waiting') {
    return <VisitorFrame><VisitorWaiting
      message={message}
      photoError={photoError}
      callId={callId}
      eventId={eventId}
      callBusy={callBusy}
      callMessage={callMessage}
      onCall={() => void requestCall()}
      onCloseCall={closeCall}
    /></VisitorFrame>
  }
  return <main className="visitor-page"><header className="visitor-header"><Link to="/" className="visitor-brand"><Logo /></Link><span className="visitor-secure"><ShieldCheck size={14} /> Conexión segura</span></header>
    <section className="visitor-card">
      {doorLoading ? <div className="visitor-loading"><span className="loading-spinner" /><p>Un segundito…</p></div> : unavailable ? <><div className="visitor-result-icon muted-result"><DoorOpen size={26} /></div><span className="eyebrow">TIMBRE NO DISPONIBLE</span><h1>Por ahora no se puede tocar.</h1><p>{message || 'El timbre está pausado o el enlace ya no está activo.'}</p></> : phase === 'answered' ? <><div className="visitor-result-icon answered-result"><Bell size={26} /></div><span className="eyebrow">RESPUESTA RECIBIDA</span><h1>{response}</h1><p>Ya le avisamos que llegaste. ¡Gracias por esperar!</p><button className="visitor-secondary" onClick={retry}>Volver al inicio</button></> : phase === 'expired' ? <><div className="visitor-result-icon muted-result"><Bell size={25} /></div><span className="eyebrow">SIN RESPUESTA</span><h1>No hubo respuesta.</h1><p>Podés volver a intentar en un momento.</p><button className="button button-dark full-width visitor-retry" onClick={retry}>Volver a intentar <ChevronRight size={18} /></button></> : phase === 'waiting' ? <><div className="visitor-result-icon waiting-result"><span className="loading-spinner" /></div><span className="eyebrow">AVISANDO</span><h1>Ya le avisamos.</h1><p>Esperá un momentito, estamos esperando la respuesta.</p>{message && <p className="visitor-notification-warning" role="status">{message}</p>}<div className="waiting-dots"><i /><i /><i /></div><span className="visitor-wait-note">Te mostramos la respuesta acá mismo.</span></> : <><div className="visitor-bell-mark"><Bell size={27} /></div><span className="eyebrow">HOLA, LLEGASTE</span><h1>Dejá un aviso<br />y ya le contamos.</h1><p className="visitor-intro">No hace falta instalar nada. Completá tus datos si querés y tocá el timbre.</p><label className="visitor-label" htmlFor="visitor-name">¿Quién sos? <span>Opcional</span></label><input className="visitor-name-input" id="visitor-name" placeholder="Tu nombre" maxLength={40} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /><span className="visitor-label reason-label">¿A qué venís?</span><div className="reason-chips">{quickReasons.map((item) => <button key={item} className={reason === item ? 'reason-selected' : ''} onClick={() => setReason(item)}>{item}</button>)}</div>{turnstileSiteKey ? <div className="turnstile-slot"><Suspense fallback={<span className="loading-spinner" />}><TurnstileWidget key={widgetKey} siteKey={turnstileSiteKey} onSuccess={setToken} onExpire={() => setToken('')} onError={() => { setToken(''); setMessage('No pudimos verificar la solicitud. Actualizá el desafío y probá de nuevo.') }} options={{ action: 'door_ring', language: 'es', theme: 'light', size: 'flexible' }} /></Suspense></div> : <div className="turnstile-missing">Falta configurar la verificación antispam para habilitar el timbre.</div>}<button className="button button-dark visitor-ring" onClick={() => void ring()} disabled={!token || busy || !turnstileSiteKey}>{busy ? <><span className="button-spinner" /> Avisando…</> : <><Bell size={19} fill="currentColor" /> Tocar timbre</>}</button>{message && <p className="inline-error visitor-error" role="alert">{message}</p>}<div className="visitor-privacy"><ShieldCheck size={14} /> Tu información no se comparte ni se muestra públicamente.</div></>}
    </section><footer className="visitor-footer"><Logo /><span>Un aviso y listo.</span></footer>
  </main>
}

function VisitorFrame({ children }: { children: React.ReactNode }) {
  return <main className="visitor-page"><header className="visitor-header"><Link to="/" className="visitor-brand"><Logo /></Link><span className="visitor-secure"><ShieldCheck size={14} /> Conexión segura</span></header><section className="visitor-card">{children}</section><footer className="visitor-footer"><Logo /><span>Un aviso y listo.</span></footer></main>
}

function VisitorStartForm({
  name,
  onNameChange,
  reason,
  onReasonChange,
  photoPreview,
  photoError,
  onPhotoSelect,
  onPhotoRemove,
  token,
  widgetKey,
  onToken,
  onError,
  message,
  busy,
  onRing,
}: {
  name: string
  onNameChange: (value: string) => void
  reason: string
  onReasonChange: (value: string) => void
  photoPreview: string
  photoError: string
  onPhotoSelect: (file: File | undefined) => void
  onPhotoRemove: () => void
  token: string
  widgetKey: number
  onToken: (value: string) => void
  onError: (value: string) => void
  message: string
  busy: boolean
  onRing: () => void
}) {
  return <>
    <div className="visitor-bell-mark"><Bell size={27} /></div><span className="eyebrow">HOLA, LLEGASTE</span><h1>Dejá un aviso<br />y ya le contamos.</h1><p className="visitor-intro">No hace falta instalar nada. Completá tus datos si querés y tocá el timbre.</p>
    <label className="visitor-label" htmlFor="visitor-name">¿Quién sos? <span>Opcional</span></label>
    <input className="visitor-name-input" id="visitor-name" placeholder="Tu nombre" maxLength={40} autoComplete="name" value={name} onChange={(event) => onNameChange(event.target.value)} />
    <span className="visitor-label reason-label">¿A qué venís?</span>
    <div className="reason-chips">{quickReasons.map((item) => <button key={item} className={reason === item ? 'reason-selected' : ''} onClick={() => onReasonChange(item)}>{item}</button>)}</div>
    <label className="visitor-photo-picker">
      <Camera size={17} /><span>{photoPreview ? 'Cambiar foto (opcional)' : 'Agregar foto (opcional)'}</span>
      <input key={photoPreview ? 'photo-selected' : 'photo-empty'} type="file" accept="image/*" capture="environment" onChange={(event) => onPhotoSelect(event.target.files?.[0])} />
    </label>
    {photoPreview && <div className="visitor-photo-preview"><img src={photoPreview} alt="Vista previa de la foto para el residente" /><button type="button" aria-label="Quitar foto" onClick={onPhotoRemove}><X size={16} /></button></div>}
    <p className="field-hint">La foto es opcional, solo la ven los residentes de esta puerta y se elimina con el historial.</p>
    {photoError && <p className="inline-error" role="alert">{photoError}</p>}
    {turnstileSiteKey ? <div className="turnstile-slot"><Suspense fallback={<span className="loading-spinner" />}><TurnstileWidget key={widgetKey} siteKey={turnstileSiteKey} onSuccess={onToken} onExpire={() => onToken('')} onError={() => { onToken(''); onError('No pudimos verificar la solicitud. Actualizá el desafío y probá de nuevo.') }} options={{ action: 'door_ring', language: 'es', theme: 'light', size: 'flexible' }} /></Suspense></div> : <div className="turnstile-missing">Falta configurar la verificación antispam para habilitar el timbre.</div>}
    <button className="button button-dark visitor-ring" onClick={onRing} disabled={!token || busy || !turnstileSiteKey}>{busy ? <><span className="button-spinner" /> Avisando…</> : <><Bell size={19} fill="currentColor" /> Tocar timbre</>}</button>
    {message && <p className="inline-error visitor-error" role="alert">{message}</p>}
    <div className="visitor-privacy"><ShieldCheck size={14} /> Tu información no se comparte ni se muestra públicamente.</div>
  </>
}

function VisitorWaiting({
  message,
  photoError,
  callId,
  eventId,
  callBusy,
  callMessage,
  onCall,
  onCloseCall,
}: {
  message: string
  photoError: string
  callId: string
  eventId: string
  callBusy: boolean
  callMessage: string
  onCall: () => void
  onCloseCall: () => void
}) {
  return <>
    <div className="visitor-result-icon waiting-result"><span className="loading-spinner" /></div><span className="eyebrow">AVISANDO</span><h1>Ya le avisamos.</h1><p>Esperá un momentito, estamos esperando la respuesta.</p>
    {message && <p className="visitor-notification-warning" role="status">{message}</p>}
    {photoError && <p className="visitor-notification-warning" role="status">{photoError}</p>}
    {callId ? <CallSession eventId={eventId} callId={callId} role="visitor" onClose={onCloseCall} /> : <>
      <button className="button button-quiet full-width visitor-call" disabled={callBusy} onClick={onCall}><Phone size={17} /> {callBusy ? 'Llamando…' : 'Iniciar llamada de audio/video'}</button>
      {callMessage && <p className="inline-error" role="alert">{callMessage}</p>}
      <div className="waiting-dots"><i /><i /><i /></div><span className="visitor-wait-note">Te mostramos la respuesta acá mismo.</span>
    </>}
  </>
}
