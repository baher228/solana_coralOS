import React, { useEffect, useMemo, useState } from 'react'
import { api } from './lib/api.js'
import { loadSession } from './lib/session.js'
import { loadMode, saveMode, roleForMode } from './lib/mode.js'
import { preferredJobId } from './lib/selectors.js'
import { Login } from './components/Login.jsx'
import { AppShell } from './components/Layout.jsx'
import { Agents } from './views/Agents.jsx'
import { Chats } from './views/Chats.jsx'
import { Dashboard } from './views/Dashboard.jsx'
import { WalletView } from './views/Wallet.jsx'
import { Settings } from './views/Settings.jsx'
import { YourJobs } from './views/Jobs.jsx'
import { SESSION_KEY } from './lib/config.js'

export function App() {
  const [session, setSession] = useState(loadSession)
  const [mode, setModeState] = useState(loadMode)
  const [data, setData] = useState({ jobs: [], summary: {}, setup: { wallets: {}, note: '' } })
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState('dashboard')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The lens: account identity with its role swapped for the current mode.
  // Passed to every view in place of the raw session so the existing
  // role-driven selectors respond to the Hiring/Working toggle.
  const lens = useMemo(
    () => (session ? { ...session, role: roleForMode(mode) } : null),
    [session, mode],
  )

  const setMode = (next) => {
    setModeState(next)
    saveMode(next)
  }

  const refresh = async () => {
    const next = await api('/api/platform')
    setData(next)
    setSelectedId((current) => next.jobs.some((job) => job.id === current) ? current : preferredJobId(next.jobs, lens))
  }

  const act = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const createTask = async (payload) => {
    setBusy(true)
    setError('')
    try {
      const next = await api('/api/jobs', payload)
      setData(next)
      setSelectedId(next.jobs[0]?.id || '')
      setView('jobs')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (session) refresh().catch((e) => setError(e.message || String(e)))
  }, [session])

  // Switching mode re-picks the most relevant job for the new lens.
  useEffect(() => {
    setSelectedId((current) => {
      const stillRelevant = data.jobs.some((job) => job.id === current)
      return stillRelevant ? current : preferredJobId(data.jobs, lens)
    })
    setView('dashboard')
  }, [mode])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    document.querySelector('.escrow-content')?.scrollTo({ top: 0, left: 0 })
  }, [view])

  const selected = useMemo(
    () => data.jobs.find((job) => job.id === selectedId) || data.jobs[0],
    [data.jobs, selectedId],
  )

  const login = (nextSession) => {
    setSession(nextSession)
    setView('dashboard')
  }

  if (!session) return <Login onLogin={login} />

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  const content = view === 'jobs'
    ? <YourJobs data={data} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} session={lens} createTask={createTask} act={act} />
    : view === 'chats'
      ? <Chats jobs={data.jobs} selectedId={selectedId} setSelectedId={setSelectedId} act={act} session={lens} />
      : view === 'agents'
        ? <Agents session={lens} data={data} />
        : view === 'wallet'
          ? <WalletView data={data} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} session={lens} act={act} />
          : view === 'settings'
            ? <Settings data={data} act={act} refresh={refresh} />
            : <Dashboard data={data} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} session={lens} act={act} />

  return (
    <AppShell
      session={lens}
      mode={mode}
      setMode={setMode}
      data={data}
      selected={selected}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      view={view}
      setView={setView}
      refresh={refresh}
      busy={busy}
      error={error}
      onLogout={logout}
    >
      {content}
    </AppShell>
  )
}
