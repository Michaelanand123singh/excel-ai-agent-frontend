import { NavLink } from 'react-router-dom'
import { ChartBarIcon, CloudArrowUpIcon, CommandLineIcon, HomeIcon, DocumentIcon, XMarkIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useDatasets } from '../../store/datasets'

export default function Sidebar({ variant = 'static', open = false, onClose }: { variant?: 'static' | 'drawer'; open?: boolean; onClose?: () => void }) {
  const containerClass = variant === 'static'
    ? 'hidden md:flex flex-col w-64 border-r bg-white min-h-screen'
    : `fixed inset-y-0 left-0 w-64 border-r bg-white z-40 transform transition-transform duration-200 md:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`

  return (
    <aside className={containerClass} aria-hidden={variant === 'drawer' && !open}>
      <div className="h-14 border-b flex items-center justify-between px-4 font-semibold text-gray-900">
        <span>Excel AI Agent</span>
        {variant === 'drawer' && (
          <button className="p-2 rounded hover:bg-gray-100" onClick={onClose} aria-label="Close sidebar">
            <XMarkIcon className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className="p-3 space-y-1 text-sm flex-1 overflow-y-auto">
        <NavItem to="/dashboard" icon={<HomeIcon className="w-5 h-5" />} label="Dashboard" />
        <NavItem to="/upload" icon={<CloudArrowUpIcon className="w-5 h-5" />} label="Upload" />
        <NavItem to="/files" icon={<DocumentIcon className="w-5 h-5" />} label="Files" />
        <NavItem to="/query" icon={<CommandLineIcon className="w-5 h-5" />} label="Query" />
        <NavItem to="/analytics" icon={<ChartBarIcon className="w-5 h-5" />} label="Analytics" />
      </nav>
      <RecentDatasets />
      <div className="mt-auto p-3 text-xs text-gray-500 border-t">v0.1.0</div>
    </aside>
  )
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}>
      {icon}
      <span>{label}</span>
    </NavLink>
  )
}

function RecentDatasets() {
  const { files } = useDatasets()
  const safeFiles = Array.isArray(files) ? files : []
  if (!safeFiles.length) return null
  return (
    <div className="p-3">
      <div className="text-xs font-medium text-gray-500 mb-2">Recent</div>
      <div className="space-y-1">
        {safeFiles.slice(0, 5).map(d => (
          <NavLink key={d.id} to={`/query?fileId=${d.id}`} className="block text-xs text-gray-700 hover:text-blue-700 truncate">
            {d.filename}
          </NavLink>
        ))}
      </div>
    </div>
  )
}


