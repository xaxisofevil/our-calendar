import { useEffect, useState } from 'react'

type HealthResponse = {
  status: string
  service: string
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setError('Could not reach backend'))
  }, [])

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
      <h1 className="text-3xl font-semibold text-slate-900">Our Calendar</h1>
      <p className="text-slate-500">M0 skeleton — frontend and backend wired up.</p>
      <p className="text-sm font-mono text-slate-400">
        {error ? error : health ? `backend: ${health.status} (${health.service})` : 'checking backend…'}
      </p>
    </div>
  )
}

export default App
