import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { Mic, Upload, FileText } from 'lucide-react'
import HomePage from './pages/HomePage'
import RealtimePage from './pages/RealtimePage'
import UploadPage from './pages/UploadPage'
import MeetingDetailPage from './pages/MeetingDetailPage'

export default function App() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-gray-900 text-lg">
            <span className="text-2xl">🎙️</span>
            <span>Freedom Notetaker</span>
          </Link>
          <nav className="flex items-center gap-1 ml-4">
            <NavLink to="/" label="Встречи" icon={<FileText size={16} />} active={pathname === '/'} />
            <NavLink to="/realtime" label="Прямой эфир" icon={<Mic size={16} />} active={pathname.startsWith('/realtime')} />
            <NavLink to="/upload" label="Загрузить" icon={<Upload size={16} />} active={pathname.startsWith('/upload')} />
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/realtime" element={<RealtimePage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/meetings/:id" element={<MeetingDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}

function NavLink({ to, label, icon, active }: { to: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}
