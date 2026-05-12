import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Trash2, Mic, Upload, Clock, FileText, ChevronRight } from 'lucide-react'
import { api, formatDuration, MeetingListItem } from '../api/client'
import { formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  recording: { label: 'Запись', cls: 'bg-red-100 text-red-700 animate-pulse' },
  processing: { label: 'Обработка', cls: 'bg-yellow-100 text-yellow-700 animate-pulse' },
  done: { label: 'Готово', cls: 'bg-green-100 text-green-700' },
  error: { label: 'Ошибка', cls: 'bg-red-100 text-red-700' },
}

export default function HomePage() {
  const qc = useQueryClient()
  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ['meetings'],
    queryFn: api.listMeetings,
    refetchInterval: (data) =>
      data?.some((m) => m.status === 'recording' || m.status === 'processing') ? 3000 : false,
  })

  const del = useMutation({
    mutationFn: api.deleteMeeting,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meetings'] }),
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (!meetings.length) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center">
        <div className="text-6xl">🎙️</div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Нет встреч</h2>
          <p className="text-gray-500 text-sm">Начните запись или загрузите аудио/видео файл</p>
        </div>
        <div className="flex gap-3">
          <Link
            to="/realtime"
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            <Mic size={16} /> Начать запись
          </Link>
          <Link
            to="/upload"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <Upload size={16} /> Загрузить файл
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Встречи</h1>
        <div className="flex gap-2">
          <Link
            to="/realtime"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
          >
            <Mic size={14} /> Новая запись
          </Link>
          <Link
            to="/upload"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <Upload size={14} /> Загрузить
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        {meetings.map((m) => (
          <MeetingRow key={m.id} meeting={m} onDelete={() => del.mutate(m.id)} />
        ))}
      </div>
    </div>
  )
}

function MeetingRow({ meeting: m, onDelete }: { meeting: MeetingListItem; onDelete: () => void }) {
  const st = STATUS_LABELS[m.status] ?? STATUS_LABELS.done

  return (
    <Link
      to={`/meetings/${m.id}`}
      className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-brand-300 hover:shadow-sm transition-all group"
    >
      <div className="flex-shrink-0 w-10 h-10 bg-brand-50 rounded-lg flex items-center justify-center">
        <FileText size={20} className="text-brand-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-gray-900 truncate">{m.title}</span>
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', st.cls)}>{st.label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ru })}</span>
          {m.duration_seconds && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock size={11} /> {formatDuration(m.duration_seconds)}
              </span>
            </>
          )}
          {m.segment_count > 0 && (
            <>
              <span>·</span>
              <span>{m.segment_count} фраз</span>
            </>
          )}
        </div>
      </div>
      <button
        onClick={(e) => { e.preventDefault(); onDelete() }}
        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all rounded"
      >
        <Trash2 size={16} />
      </button>
      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-400 flex-shrink-0" />
    </Link>
  )
}
