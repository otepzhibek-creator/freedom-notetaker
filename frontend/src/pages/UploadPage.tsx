import { useState, useRef, DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, FileAudio, FileVideo, X, Loader2, Youtube, Link, Video } from 'lucide-react'
import { api } from '../api/client'
import clsx from 'clsx'

const ACCEPT = '.wav,.mp3,.ogg,.flac,.m4a,.aac,.mp4,.mkv,.webm,.avi,.mov'

type Tab = 'file' | 'youtube' | 'meet'

export default function UploadPage() {
  const [tab, setTab] = useState<Tab>('file')

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Загрузить запись</h1>
        <p className="text-gray-500 text-sm">Аудио, видео файл, YouTube или Google Meet</p>
      </div>

      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
        <TabBtn active={tab === 'file'} onClick={() => setTab('file')} icon={<Upload size={14} />} label="Файл" />
        <TabBtn active={tab === 'youtube'} onClick={() => setTab('youtube')} icon={<Youtube size={14} />} label="YouTube" />
        <TabBtn active={tab === 'meet'} onClick={() => setTab('meet')} icon={<Video size={14} />} label="Google Meet" />
      </div>

      {tab === 'file' ? <FileUpload /> : tab === 'youtube' ? <YoutubeUpload /> : <MeetUpload />}
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {icon}{label}
    </button>
  )
}

function FileUpload() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [progress, setProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0]
    if (!f) return
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const submit = async () => {
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const result = await api.uploadFile(file, title || file.name, false, setProgress)
      navigate(`/meetings/${result.meeting_id}`)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки')
      setUploading(false)
    }
  }

  const isVideo = file && /\.(mp4|mkv|webm|avi|mov)$/i.test(file.name)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !file && inputRef.current?.click()}
        className={clsx(
          'border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 transition-colors',
          !file && 'cursor-pointer',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-gray-400',
        )}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        {file ? (
          <div className="flex items-center gap-3 w-full">
            {isVideo ? <FileVideo size={32} className="text-brand-500 shrink-0" /> : <FileAudio size={32} className="text-brand-500 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{file.name}</p>
              <p className="text-sm text-gray-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setFile(null); setTitle('') }} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
              <X size={18} />
            </button>
          </div>
        ) : (
          <>
            <Upload size={32} className="text-gray-400" />
            <div className="text-center">
              <p className="font-medium text-gray-700">Перетащите файл или нажмите для выбора</p>
              <p className="text-sm text-gray-400 mt-1">WAV, MP3, OGG, FLAC, M4A, MP4, MKV, WebM</p>
            </div>
          </>
        )}
      </div>

      {file && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {uploading && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500">
                <span>{progress < 100 ? 'Загрузка...' : 'Транскрипция...'}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-brand-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={submit}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-60 transition-colors font-semibold"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {uploading ? 'Обработка...' : 'Загрузить и транскрибировать'}
          </button>
        </>
      )}
    </div>
  )
}

function YoutubeUpload() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValidUrl = url.includes('youtube.com') || url.includes('youtu.be')

  const submit = async () => {
    if (!isValidUrl) return
    setError(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('url', url)
      fd.append('diarization', 'false')
      const res = await fetch('/api/transcribe/youtube', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      navigate(`/meetings/${data.meeting_id}`)
    } catch (e: any) {
      setError(e.message || 'Ошибка')
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
      <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-100">
        <Youtube size={28} className="text-red-500 shrink-0" />
        <div>
          <p className="font-medium text-gray-900 text-sm">YouTube видео</p>
          <p className="text-xs text-gray-500">Автоматически скачает аудио и транскрибирует</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Ссылка на видео</label>
        <div className="relative">
          <Link size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full pl-9 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        onClick={submit}
        disabled={loading || !isValidUrl}
        className="w-full flex items-center justify-center gap-2 py-3 bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors font-semibold"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Youtube size={18} />}
        {loading ? 'Скачивание и обработка...' : 'Транскрибировать YouTube'}
      </button>

      {loading && (
        <p className="text-xs text-gray-500 text-center">
          Скачиваем видео → нарезаем на части → транскрибируем.<br />
          Для длинных видео может занять несколько минут.
        </p>
      )}
    </div>
  )
}

function MeetUpload() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValidUrl = url.includes('meet.google.com/')

  const submit = async () => {
    if (!isValidUrl) return
    setError(null)
    setLoading(true)
    try {
      const result = await api.startMeetBot(url, title || 'Google Meet')
      navigate(`/meetings/${result.meeting_id}`)
    } catch (e: any) {
      setError(e.message || 'Ошибка')
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
      <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <Video size={28} className="text-blue-500 shrink-0" />
        <div>
          <p className="font-medium text-gray-900 text-sm">Google Meet бот</p>
          <p className="text-xs text-gray-500">
            Бот откроет браузер, зайдёт на встречу и запишет транскрипцию в реальном времени
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ссылка на встречу</label>
          <div className="relative">
            <Link size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="https://meet.google.com/abc-defg-hij"
              className="w-full pl-9 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Название встречи</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Планёрка, демо, интервью..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        onClick={submit}
        disabled={loading || !isValidUrl}
        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 transition-colors font-semibold"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />}
        {loading ? 'Запускаем бот...' : 'Подключить бота к встрече'}
      </button>

      <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-600">Требования:</p>
        <p>• <code className="bg-gray-200 px-1 rounded">pip install playwright</code> и <code className="bg-gray-200 px-1 rounded">python -m playwright install chrome</code></p>
        <p>• Организатор встречи должен пустить бота (появится в списке участников как "Freedom Notetaker")</p>
        <p>• Встреча должна разрешать вход без аккаунта Google</p>
      </div>
    </div>
  )
}
