import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react'
import { supabase } from '../lib/supabase'

type CallSessionProps = {
  eventId: string
  callId: string
  role: 'visitor' | 'resident'
  onClose: () => void
}

type CallSignal = {
  status: string
  offer: RTCSessionDescriptionInit | null
  answer: RTCSessionDescriptionInit | null
  candidates: RTCIceCandidateInit[]
}

export function CallSession({ eventId, callId, role, onClose }: CallSessionProps) {
  const localVideo = useRef<HTMLVideoElement>(null)
  const remoteVideo = useRef<HTMLVideoElement>(null)
  const onCloseRef = useRef(onClose)
  const peer = useRef<RTCPeerConnection | null>(null)
  const localStream = useRef<MediaStream | null>(null)
  const remoteCandidatesRead = useRef(0)
  const [status, setStatus] = useState('Esperando que atiendan…')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [connected, setConnected] = useState(false)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!supabase) return
    let active = true
    let polling = false
    let failed = false
    let offerSent = false
    let answerSent = false

    async function signal(action: string, extra: Record<string, unknown> = {}) {
      if (!supabase) throw new Error('La conexión no está disponible.')
      const { data, error: signalError } = await supabase.functions.invoke('door-call-signal', {
        body: { action, call_id: callId, ...(role === 'visitor' ? { event_id: eventId } : {}), ...extra },
      })
      if (signalError) throw signalError
      return data
    }

    async function ensurePeer() {
      if (peer.current) return peer.current
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      if (!active) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error('La llamada ya se cerró.')
      }
      localStream.current = stream
      if (localVideo.current) localVideo.current.srcObject = stream
      const connection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ],
      })
      stream.getTracks().forEach((track) => connection.addTrack(track, stream))
      connection.ontrack = (event) => {
        if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0]
      }
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          void signal('candidate', { candidate: event.candidate.toJSON() })
            .catch((signalError: unknown) => {
              if (active) setError(signalError instanceof Error ? signalError.message : 'No se pudo establecer la conexión de llamada.')
            })
        }
      }
      connection.onconnectionstatechange = () => {
        setConnected(connection.connectionState === 'connected')
        if (connection.connectionState === 'connected') setError('')
        if (connection.connectionState === 'failed') {
          setError('No se pudo conectar. Puede que una de las redes necesite un servidor TURN.')
        }
      }
      peer.current = connection
      return connection
    }

    async function poll() {
      if (!active || polling || failed) return
      polling = true
      try {
        const remote = await signal('poll') as CallSignal
        if (!active) return
        if (remote.status === 'rejected' || remote.status === 'ended' || remote.status === 'expired') {
          setStatus(remote.status === 'rejected' ? 'La llamada fue rechazada.' : 'La llamada terminó.')
          if (remote.status === 'rejected' || remote.status === 'expired') window.setTimeout(() => onCloseRef.current(), 1800)
          return
        }

        if (remote.status === 'ringing' && role === 'visitor') {
          setStatus('Esperando que atiendan…')
          return
        }
        if (remote.status !== 'accepted') return

        const connection = await ensurePeer()
        setStatus('Conectando audio y video…')
        if (role === 'visitor' && !offerSent) {
          const offer = await connection.createOffer()
          await connection.setLocalDescription(offer)
          await signal('offer', { description: connection.localDescription })
          offerSent = true
        }
        if (role === 'resident' && remote.offer && !answerSent) {
          await connection.setRemoteDescription(remote.offer)
          const answer = await connection.createAnswer()
          await connection.setLocalDescription(answer)
          await signal('answer', { description: connection.localDescription })
          answerSent = true
        }
        if (role === 'visitor' && remote.answer && connection.signalingState === 'have-local-offer') {
          await connection.setRemoteDescription(remote.answer)
        }
        if (connection.remoteDescription && remote.candidates.length > remoteCandidatesRead.current) {
          const newCandidates = remote.candidates.slice(remoteCandidatesRead.current)
          for (const candidate of newCandidates) await connection.addIceCandidate(candidate)
          remoteCandidatesRead.current = remote.candidates.length
        }
        if (connection.connectionState === 'connected') setStatus('Llamada conectada')
      } catch (callError) {
        if (active) {
          failed = true
          setError(callError instanceof Error ? callError.message : 'No se pudo iniciar la llamada.')
          setStatus('No se pudo establecer la llamada.')
        }
      } finally {
        polling = false
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), 1200)
    return () => {
      active = false
      window.clearInterval(interval)
      peer.current?.close()
      peer.current = null
      localStream.current?.getTracks().forEach((track) => track.stop())
      localStream.current = null
    }
  }, [callId, eventId, role])

  async function hangUp() {
    if (!supabase) return
    const { error: endError } = await supabase.functions.invoke('door-call-signal', {
      body: {
        action: 'hangup',
        call_id: callId,
        ...(role === 'visitor' ? { event_id: eventId } : {}),
      },
    })
    if (endError) {
      setError(`No se pudo finalizar la llamada: ${endError.message}`)
      return
    }
    onClose()
  }

  function toggleMicrophone() {
    const track = localStream.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  function toggleCamera() {
    const track = localStream.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setCameraEnabled(track.enabled)
  }

  return (
    <section className="call-session" aria-label="Llamada de audio y video">
      <div className="call-videos">
        <video ref={remoteVideo} autoPlay playsInline className="call-remote-video" aria-label="Video remoto" />
        <video ref={localVideo} autoPlay muted playsInline className="call-local-video" aria-label="Tu video" />
        {!connected && <div className="call-placeholder"><Phone size={23} /><span>{status}</span></div>}
      </div>
      <p className="call-status" role="status">{status}</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <p className="call-network-note">La calidad depende de la conexión y de las restricciones de las redes de ambos dispositivos.</p>
      <div className="call-controls">
        <button type="button" className="call-control" onClick={toggleMicrophone} aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}><span>{muted ? <MicOff size={17} /> : <Mic size={17} />}</span>{muted ? 'Activar audio' : 'Silenciar'}</button>
        <button type="button" className="call-control" onClick={toggleCamera} aria-label={cameraEnabled ? 'Apagar cámara' : 'Activar cámara'}><span>{cameraEnabled ? <Video size={17} /> : <VideoOff size={17} />}</span>{cameraEnabled ? 'Apagar cámara' : 'Activar cámara'}</button>
        <button type="button" className="call-control call-end" onClick={() => void hangUp()}><span><PhoneOff size={17} /></span>Finalizar</button>
      </div>
    </section>
  )
}
