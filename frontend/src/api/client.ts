const BASE = '/api'

export interface TranscriptSegment {
  id: number
  start_time: number
  end_time: number
  text: string
  speaker: string | null
  confidence: number | null
}

export interface MeetingAnalysis {
  summary: string | null
  action_items: string | null
  key_topics: string | null
  decisions: string | null
  speaker_stats: string | null
}

export interface Meeting {
  id: string
  title: string
  status: 'recording' | 'processing' | 'done' | 'error'
  created_at: string
  finished_at: string | null
  duration_seconds: number | null
  segments: TranscriptSegment[]
  analysis: MeetingAnalysis | null
}

export interface MeetingListItem {
  id: string
  title: string
  status: Meeting['status']
  created_at: string
  finished_at: string | null
  duration_seconds: number | null
  segment_count: number
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    // Try to extract a clean message from JSON error body {"detail": "..."}
    try {
      const json = JSON.parse(text)
      throw new Error(json.detail || json.message || text)
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error(text.slice(0, 200))
      throw e
    }
  }
  return res.json()
}

export const api = {
  listMeetings: () => req<MeetingListItem[]>('/meetings'),
  getMeeting: (id: string) => req<Meeting>(`/meetings/${id}`),
  createMeeting: (title: string) =>
    req<Meeting>('/meetings', { method: 'POST', body: JSON.stringify({ title }) }),
  deleteMeeting: (id: string) =>
    req<{ ok: boolean }>(`/meetings/${id}`, { method: 'DELETE' }),
  updateTitle: (id: string, title: string) =>
    req<{ ok: boolean }>(`/meetings/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  analyzeMeeting: (id: string) =>
    req<{ ok: boolean }>(`/meetings/${id}/analyze`, { method: 'POST' }),

  uploadFile: async (
    file: File,
    title: string,
    diarization: boolean,
    onProgress?: (pct: number) => void,
  ): Promise<{ meeting_id: string; status: string }> => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', title)
    fd.append('diarization', String(diarization))

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/transcribe/upload')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
        else reject(new Error(xhr.responseText))
      }
      xhr.onerror = () => reject(new Error('Upload failed'))
      xhr.send(fd)
    })
  },
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const SPEAKER_COLORS: Record<string, string> = {}
const PALETTE = [
  'bg-blue-100 text-blue-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-cyan-100 text-cyan-800',
]
let colorIdx = 0
export function speakerColor(speaker: string | null): string {
  if (!speaker) return 'bg-gray-100 text-gray-600'
  if (!SPEAKER_COLORS[speaker]) {
    SPEAKER_COLORS[speaker] = PALETTE[colorIdx % PALETTE.length]
    colorIdx++
  }
  return SPEAKER_COLORS[speaker]
}
