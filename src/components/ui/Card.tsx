import React from 'react'

export function Card({ children, className, ...rest }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-xl border bg-white shadow-sm ${className || ''}`} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, description, className, ...rest }: { title?: string; description?: string; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 py-4 border-b ${className || ''}`} {...rest}>
      {title && <div className="text-sm font-medium text-gray-900">{title}</div>}
      {description && <div className="text-xs text-gray-500 mt-1">{description}</div>}
    </div>
  )
}

export function CardContent({ children, className, ...rest }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-5 py-4 ${className || ''}`} {...rest}>
      {children}
    </div>
  )
}
