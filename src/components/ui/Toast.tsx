import { useEffect, useState } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

export function Toast({ 
  message, 
  onClose, 
  duration = 3000, 
  type = 'info' 
}: { 
  message: string
  onClose: () => void
  duration?: number
  type?: ToastType
}) {
  const [open, setOpen] = useState(true)
  
  useEffect(() => {
    const t = setTimeout(() => { setOpen(false); onClose() }, duration)
    return () => clearTimeout(t)
  }, [duration, onClose])
  
  if (!open) return null

  const typeStyles = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  }

  return (
    <div className="fixed top-4 right-4 z-50">
      <div className={`rounded-lg border px-4 py-3 shadow-lg text-sm font-medium ${typeStyles[type]}`}>
        {message}
      </div>
    </div>
  )
}


