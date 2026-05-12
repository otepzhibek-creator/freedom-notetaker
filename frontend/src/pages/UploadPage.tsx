import { useState, useRef, DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, FileAudio, FileVideo, X, Loader2 } from 'lucide-react'
import { api } from '../api/client'
import clsx from 'clsx'

const ACCEPT = '.wav,.mp3,.ogg,.flac,.m4a,.aac,.mp4,.mkv,.webm,.avi,.mov'

export default function UploadPage() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [diarization, setDiarization] = useState(true)
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
      const result = await api.uploadFile(file, title || file.name, diarization, setProgress)
      navigate(`/meetings/${result.meeting_id}`)
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки')
      setUploading(false)
    }
  }

  const isVideo = file && /\.(mp4|mkv|webm|avi|mov)$/i.test(file.name)

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Загрузить запись</h1>
        <p className="text-gray-500 text-sm">Аудио (WAV, MP3, OGG, FLAC, M4A) или видео (MP4, MKV, WebM)</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !file && inputRef.current?.click()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors',
            dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-300 hover:border-gray-400',
            file && 'cursor-default',
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
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setTitle('') }}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors"
              >
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Название встречи</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={diarization}
                onChange={(e) => setDiarization(e.target.checked)}
                className="w-4 h-4 text-brand-600 rounded"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Определять спикеров</span>
                <p className="text-xs text-gray-500">Требует pyannote.audio + HuggingFace токен (может быть медленно без GPU)</p>
              </div>
            </label>

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
    </div>
  )
}
