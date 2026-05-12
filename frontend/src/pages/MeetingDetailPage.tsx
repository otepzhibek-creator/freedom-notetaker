import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import {
  ArrowLeft, Sparkles, Clock, Users, ListChecks, Lightbulb,
  CheckSquare, Loader2, Edit2, Check, X, RefreshCw, UserCircle,
} from 'lucide-react'
import { api, Meeting, formatDuration, formatTime, speakerColor } from '../api/client'
import clsx from 'clsx'

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: meeting, isLoading } = useQuery<Meeting>({
    queryKey: ['meeting', id],
    queryFn: () => api.getMeeting(id!),
    refetchInterval: (query) => {
      const data = query.state.data as Meeting | undefined
      return data?.status === 'recording' || data?.status === 'processing' ? 2000 : false
    },
    enabled: !!id,
  })

  const analyze = useMutation({
    mutationFn: () => api.analyzeMeeting(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting', id] }),
  })

  const [editTitle, setEditTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const saveTitle = async () => {
    await api.updateTitle(id!, titleValue)
    qc.invalidateQueries({ queryKey: ['meeting', id] })
    setEditTitle(false)
  }

  // Speaker name editing
  const speakerNames: Record<string, string> = tryParse(meeting?.speaker_names, {})
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null)
  const [speakerInput, setSpeakerInput] = useState('')
  const speakerInputRef = useRef<HTMLInputElement>(null)

  const saveSpeakerName = async (speakerId: string, name: string) => {
    const updated = { ...speakerNames, [speakerId]: name.trim() || speakerId }
    await api.updateSpeakers(id!, updated)
    qc.invalidateQueries({ queryKey: ['meeting', id] })
    setEditingSpeaker(null)
  }

  const displaySpeaker = (raw: string | null) => {
    if (!raw) return null
    return speakerNames[raw] || raw
  }

  if (isLoading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
    </div>
  )
  if (!meeting) return <div className="text-center py-20 text-gray-500">Встреча не найдена</div>

  const isProcessing = meeting.status === 'recording' || meeting.status === 'processing'

  // Collect unique speakers from segments
  const uniqueSpeakers = [...new Set(meeting.segments.map(s => s.speaker).filter(Boolean))] as string[]

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => navigate('/')} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors mt-0.5">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          {editTitle ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditTitle(false) }}
                className="text-2xl font-bold border-b-2 border-brand-500 outline-none bg-transparent flex-1"
              />
              <button onClick={saveTitle} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={18} /></button>
              <button onClick={() => setEditTitle(false)} className="p-1 text-gray-400 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-2xl font-bold text-gray-900">{meeting.title}</h1>
              <button
                onClick={() => { setTitleValue(meeting.title); setEditTitle(true) }}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 transition-all"
              >
                <Edit2 size={14} />
              </button>
            </div>
          )}
          <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
            <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium',
              meeting.status === 'done' && 'bg-green-100 text-green-700',
              meeting.status === 'processing' && 'bg-yellow-100 text-yellow-700',
              meeting.status === 'recording' && 'bg-red-100 text-red-700',
              meeting.status === 'error' && 'bg-red-100 text-red-700',
            )}>
              {isProcessing && <span className="inline-block w-2 h-2 rounded-full bg-current mr-1 animate-pulse" />}
              {{ recording: 'Запись', processing: 'Обработка', done: 'Готово', error: 'Ошибка' }[meeting.status]}
            </span>
            {meeting.duration_seconds && (
              <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(meeting.duration_seconds)}</span>
            )}
            <span>{new Date(meeting.created_at).toLocaleString('ru-RU')}</span>
          </div>
        </div>

        {meeting.status === 'done' && !meeting.analysis && (
          <button
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium shrink-0"
          >
            {analyze.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Анализировать
          </button>
        )}
        {meeting.analysis && (
          <button
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm shrink-0"
          >
            {analyze.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Обновить анализ
          </button>
        )}
      </div>

      {isProcessing && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-center gap-3 mb-6">
          <Loader2 size={18} className="animate-spin text-yellow-600" />
          <p className="text-sm text-yellow-800">
            {meeting.status === 'recording' ? 'Идёт запись...' : 'Обработка транскрипции и анализ...'}
          </p>
        </div>
      )}

      {meeting.status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-800 font-medium">Произошла ошибка при обработке</p>
          {meeting.title.startsWith('Ошибка') && (
            <p className="text-sm text-red-700 mt-1 font-mono">{meeting.title}</p>
          )}
        </div>
      )}

      {/* Speaker name editor — shown when diarization detected speakers */}
      {uniqueSpeakers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
            <UserCircle size={15} className="text-brand-500" />
            Участники — нажмите чтобы переименовать
          </h3>
          <div className="flex flex-wrap gap-2">
            {uniqueSpeakers.map((spk) => (
              <div key={spk}>
                {editingSpeaker === spk ? (
                  <div className="flex items-center gap-1">
                    <input
                      ref={speakerInputRef}
                      autoFocus
                      value={speakerInput}
                      onChange={(e) => setSpeakerInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveSpeakerName(spk, speakerInput)
                        if (e.key === 'Escape') setEditingSpeaker(null)
                      }}
                      placeholder={spk}
                      className="border border-brand-400 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <button onClick={() => saveSpeakerName(spk, speakerInput)} className="p-1 text-green-600 hover:bg-green-50 rounded">
                      <Check size={13} />
                    </button>
                    <button onClick={() => setEditingSpeaker(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingSpeaker(spk); setSpeakerInput(speakerNames[spk] || '') }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${speakerColor(spk)} hover:opacity-80 transition-opacity`}
                  >
                    <Edit2 size={10} />
                    {speakerNames[spk] || spk}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {meeting.analysis && (
          <div className="lg:col-span-2 space-y-4">
            <AnalysisPanel analysis={meeting.analysis} speakerNames={speakerNames} />
          </div>
        )}

        <div className={clsx('space-y-1', meeting.analysis ? 'lg:col-span-3' : 'lg:col-span-5')}>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Транскрипция</h2>
          {meeting.segments.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
              {isProcessing ? 'Ожидание транскрипции...' : 'Нет данных'}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {meeting.segments.map((seg) => (
                <div key={seg.id} className="flex gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <span className="text-xs text-gray-400 w-10 shrink-0 mt-0.5">{formatTime(seg.start_time)}</span>
                  <div className="flex-1">
                    {seg.speaker && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium mr-2 ${speakerColor(seg.speaker)}`}>
                        {displaySpeaker(seg.speaker)}
                      </span>
                    )}
                    <span className="text-sm text-gray-900">{seg.text}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AnalysisPanel({
  analysis,
  speakerNames,
}: {
  analysis: NonNullable<Meeting['analysis']>
  speakerNames: Record<string, string>
}) {
  const topics = tryParse<string[]>(analysis.key_topics, [])
  const actions = tryParse<string[]>(analysis.action_items, [])
  const decisions = tryParse<string[]>(analysis.decisions, [])
  const speakers = tryParse<Record<string, { name?: string; talk_time?: string }>>(analysis.speaker_stats, {})

  return (
    <>
      {analysis.summary && (
        <Section icon={<Lightbulb size={15} className="text-amber-500" />} title="Резюме">
          <p className="text-sm text-gray-700 leading-relaxed">{analysis.summary}</p>
        </Section>
      )}

      {topics.length > 0 && (
        <Section icon={<Sparkles size={15} className="text-brand-500" />} title="Ключевые темы">
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t, i) => (
              <span key={i} className="text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </Section>
      )}

      {actions.length > 0 && (
        <Section icon={<CheckSquare size={15} className="text-emerald-500" />} title="Задачи">
          <ul className="space-y-1.5">
            {actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="w-4 h-4 rounded border border-gray-300 shrink-0 mt-0.5" />
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {decisions.length > 0 && (
        <Section icon={<ListChecks size={15} className="text-violet-500" />} title="Решения">
          <ul className="space-y-1.5">
            {decisions.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="text-violet-400 shrink-0">•</span>{d}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {Object.keys(speakers).length > 0 && (
        <Section icon={<Users size={15} className="text-rose-500" />} title="Участники">
          <div className="space-y-2">
            {Object.entries(speakers).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${speakerColor(key)}`}>
                  {speakerNames[key] || val?.name || key}
                </span>
                {val?.talk_time && <span className="text-gray-500 text-xs">{val.talk_time}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-3">
        {icon}{title}
      </h3>
      {children}
    </div>
  )
}

function tryParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}
