import React from 'react'

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white shadow-sm ${className || ''}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description }: { title?: string; description?: string }) {
  return (
    <div className="px-5 py-4 border-b">
      {title && <div className="text-sm font-medium text-gray-900">{title}</div>}
      {description && <div className="text-xs text-gray-500 mt-1">{description}</div>}
    </div>
  )
}

export function CardContent({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4">{children}</div>
}


