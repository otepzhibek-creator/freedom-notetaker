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
  isFinal: boolean
}

export default function RealtimePage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [segments, setSegments] = useState<LiveSegment[]>([])
  const [partialText, setPartialText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const idxRef = useRef(0)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments, partialText])

  useEffect(() => () => stopAll(), [])

  const stopAll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    processorRef.current?.disconnect()
    audioCtxRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    wsRef.current?.close()
  }, [])

  const startRecording = async () => {
    setError(null)
    try {
      const meeting = await api.createMeeting(title || 'Встреча без названия')
      setMeetingId(meeting.id)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = ctx

      const ws = new WebSocket(`/ws/transcribe/${meeting.id}`)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'partial') {
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
              speaker: msg.speaker ?? null,
              isFinal: true,
            },
          ])
        } else if (msg.type === 'error') {
          setError(msg.error)
        }
      }

      ws.onerror = () => setError('Ошибка WebSocket соединения')

      await new Promise<void>((res, rej) => {
        ws.onopen = () => res()
        setTimeout(() => rej(new Error('WS connection timeout')), 8000)
      })

      const source = ctx.createMediaStreamSource(stream)
      const bufSize = 4096
      const processor = ctx.createScriptProcessor(bufSize, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const float32 = e.inputBuffer.getChannelData(0)
        const pcm16 = new Int16Array(float32.length)
        for (let i = 0; i < float32.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768))
        }
        ws.send(pcm16.buffer)
      }

      source.connect(processor)
      processor.connect(ctx.destination)

      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    } catch (e: any) {
      setError(e.message || 'Не удалось начать запись')
    }
  }

  const stopRecording = () => {
    stopAll()
    setRecording(false)
    setPartialText('')
    if (meetingId) navigate(`/meetings/${meetingId}`)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Прямая запись</h1>
        <p className="text-gray-500 text-sm">Транскрипция в реальном времени через Freedom Speech</p>
      </div>

      {!recording ? (
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
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={startRecording}
            className="flex items-center gap-2 px-8 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors font-semibold text-base"
          >
            <Mic size={18} /> Начать запись
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="font-mono text-lg font-semibold text-gray-900">{formatTime(elapsed)}</span>
              <span className="text-sm text-gray-500">— {title || 'Встреча без названия'}</span>
            </div>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm"
            >
              <Square size={14} fill="white" /> Остановить
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4 min-h-64 max-h-[60vh] overflow-y-auto scrollbar-thin">
            {segments.length === 0 && !partialText ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 gap-2">
                <Loader2 size={24} className="animate-spin" />
                <span className="text-sm">Ожидание речи...</span>
              </div>
            ) : (
              <div className="space-y-3">
                {segments.map((seg) => (
                  <SegmentRow key={seg.id} segment={seg} />
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

function SegmentRow({ segment: seg }: { segment: LiveSegment }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-10 text-right">
        <span className="text-xs text-gray-400">{formatTime(seg.start)}</span>
      </div>
      <div className="flex-1">
        {seg.speaker && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${speakerColor(seg.speaker)}`}>
            {seg.speaker}
          </span>
        )}
        <span className="text-gray-900 text-sm">{seg.text}</span>
      </div>
    </div>
  )
}
