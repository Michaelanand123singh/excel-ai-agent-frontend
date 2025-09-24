import { Bars3Icon, UserIcon } from '@heroicons/react/24/outline'
import { useAuth } from '../../store/auth'
import { Button } from '../ui/Button'

export default function Header({ onToggle }: { onToggle: () => void }) {
  const { email, logout } = useAuth()

  return (
    <div className="h-14 border-b bg-white flex items-center gap-3 px-3 md:px-4">
      <button className="p-2 rounded hover:bg-gray-100" onClick={onToggle}>
        <Bars3Icon className="w-5 h-5" />
      </button>
      
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-gray-900">Excel AI Agents</h1>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <UserIcon className="w-4 h-4" />
          <span>{email || 'User'}</span>
        </div>
        <Button variant="secondary" onClick={logout}>
          Logout
        </Button>
      </div>
    </div>
  )
}