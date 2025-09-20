import React from 'react'

export function Table({
  children,
  className = '',
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-gray-200 ${className}`}>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200" {...props}>
          {children}
        </table>
      </div>
    </div>
  )
}

export function TableHeader({
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className="bg-gray-50" {...props}>
      {children}
    </thead>
  )
}

export function TableBody({
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className="bg-white divide-y divide-gray-200" {...props}>
      {children}
    </tbody>
  )
}

export function TableRow({
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { className?: string }) {
  return (
    <tr
      className={`${props.onClick ? 'cursor-pointer hover:bg-gray-50' : ''} ${className}`}
      {...props}
    >
      {children}
    </tr>
  )
}

export function TableHead({
  children,
  className = '',
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { className?: string }) {
  return (
    <th
      className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${className}`}
      {...props}
    >
      {children}
    </th>
  )
}

export function TableCell({
  children,
  className = '',
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { className?: string }) {
  return (
    <td
      className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 ${className}`}
      {...props}
    >
      {children}
    </td>
  )
}
