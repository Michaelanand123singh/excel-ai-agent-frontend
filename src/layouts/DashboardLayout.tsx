import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'

export default function DashboardLayout() {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex">
      <Sidebar variant="static" />
      {/* Mobile drawer */}
      <Sidebar variant="drawer" open={open} onClose={() => setOpen(false)} />
      {open && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setOpen(false)} />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Header onToggle={() => setOpen(!open)} />
        <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
          <Outlet />
        </main>
        <footer className="h-12 border-t bg-white flex items-center justify-center text-xs text-gray-500">
          © {new Date().getFullYear()} Nextin Vision - Excel AI Agent
        </footer>
      </div>
    </div>
  )
}


