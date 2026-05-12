import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Square, Loader2 } from 'lucide-react'
import { api, formatTime, speakerColor } from '../api/client'

interface LiveSegment {
  id: string
  text: string
  start: number
  end: number
  speaker: string | null
}

type Phase = 'idle' | 'connecting' | 'recording' | 'stopping'

export default function RealtimePage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [segments, setSegments] = useState<LiveSegment[]>([])
  const [partialText, setPartialText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const idxRef = useRef(0)
  const meetingIdRef = useRef<string | null>(null)
  const intentionalStopRef = useRef(false)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments, partialText])

  // Cleanup on unmount — only close WS if we haven't intentionally stopped
  // (intentional stop lets WS close naturally so Freedom can finish)
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (!intentionalStopRef.current) wsRef.current?.close()
  }, [])

  const startRecording = async () => {
    setError(null)
    setSegments([])
    setPartialText('')
    idxRef.current = 0
    intentionalStopRef.current = false

    try {
      const meeting = await api.createMeeting(title || 'Встреча без названия')
      meetingIdRef.current = meeting.id

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      setPhase('connecting')

      const ws = new WebSocket(`/ws/transcribe/${meeting.id}`)
      wsRef.current = ws

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'ready') {
          setPhase('recording')
          startMediaRecorder(stream, ws)
        } else if (msg.type === 'partial') {
          setPartialText(msg.text || '')
        } else if (msg.type === 'final' && msg.text?.trim()) {
          setPartialText('')
          setSegments((prev) => [
            ...prev,
            {
              id: String(idxRef.current++),
              text: msg.text,
              start: msg.start ?? 0,
              end: msg.end ?? 0,
              speaker: null,
            },
          ])
        } else if (msg.type === 'error') {
          setError(msg.error || 'Ошибка Freedom Speech')
          setPhase('idle')
          stream.getTracks().forEach((t) => t.stop())
        }
      }

      ws.onerror = () => {
        setError('Ошибка соединения с сервером')
        setPhase('idle')
        stream.getTracks().forEach((t) => t.stop())
        if (timerRef.current) clearInterval(timerRef.current)
      }

      ws.onclose = () => {
        if (timerRef.current) clearInterval(timerRef.current)
        recorderRef.current?.stop()
        streamRef.current?.getTracks().forEach((t) => t.stop())
        setPhase('idle')
        // Only navigate on intentional stop (user clicked "Остановить")
        if (intentionalStopRef.current && meetingIdRef.current) {
          navigate(`/meetings/${meetingIdRef.current}`)
        }
      }

      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    } catch (e: any) {
      setError(e.message || 'Не удалось начать запись')
      setPhase('idle')
    }
  }

  const startMediaRecorder = (stream: MediaStream, ws: WebSocket) => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 16000 })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data)
      }
    }

    recorder.start(250)
  }

  const stopRecording = useCallback(() => {
    intentionalStopRef.current = true
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (timerRef.current) clearInterval(timerRef.current)
    setPartialText('')
    setPhase('stopping')

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }))
      // Safety timeout: force close if Freedom takes too long
      setTimeout(() => wsRef.current?.close(), 12000)
    } else {
      // WS already closed — navigate immediately
      const id = meetingIdRef.current
      if (id) navigate(`/meetings/${id}`)
      else setPhase('idle')
    }
  }, [navigate])

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Прямая запись</h1>
        <p className="text-gray-500 text-sm">Транскрипция в реальном времени через Freedom Speech</p>
      </div>

      {phase === 'stopping' ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 flex flex-col items-center gap-4">
          <Loader2 size={32} className="animate-spin text-brand-500" />
          <p className="font-medium text-gray-700">Завершение транскрипции...</p>
          <p className="text-sm text-gray-500">Получаем финальный результат от Freedom Speech</p>
        </div>
      ) : phase === 'idle' ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-brand-50 flex items-center justify-center">
            <Mic size={36} className="text-brand-600" />
          </div>
          <div className="w-full max-w-sm">
            <label className="block text-sm font-medium text-gray-700 mb-1">Название встречи</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Встреча без названия"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button
            onClick={startRecording}
            className="flex items-center gap-2 px-8 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors font-semibold text-base"
          >
            <Mic size={18} /> Начать запись
          </button>
        </div>
      ) : (
        /* phase === 'connecting' | 'recording' */
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="font-mono text-lg font-semibold text-gray-900">{formatTime(elapsed)}</span>
              <span className="text-sm text-gray-500">— {title || 'Встреча без названия'}</span>
            </div>
            <button
              onClick={stopRecording}
              disabled={phase === 'connecting'}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-medium text-sm"
            >
              <Square size={14} fill="white" /> Остановить
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-64 max-h-[60vh] overflow-y-auto">
            {phase === 'connecting' ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-sm">Подключение к Freedom Speech...</span>
              </div>
            ) : segments.length === 0 && !partialText ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-sm">Ожидание речи...</span>
              </div>
            ) : (
              <div className="space-y-3">
                {segments.map((seg) => (
                  <div key={seg.id} className="flex gap-3">
                    <span className="text-xs text-gray-400 w-10 shrink-0 mt-0.5">{formatTime(seg.start)}</span>
                    <div className="flex-1">
                      {seg.speaker && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${speakerColor(seg.speaker)}`}>
                          {seg.speaker}
                        </span>
                      )}
                      <span className="text-gray-900 text-sm">{seg.text}</span>
                    </div>
                  </div>
                ))}
                {partialText && (
                  <div className="flex gap-3 opacity-60">
                    <span className="text-xs text-gray-400 mt-1 w-10 shrink-0">…</span>
                    <p className="text-gray-700 italic text-sm">{partialText}</p>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
