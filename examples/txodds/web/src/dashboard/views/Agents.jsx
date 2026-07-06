import React, { useEffect, useState } from 'react'
import { Bot, Check, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { copyText } from '../../shared/api.js'
import { money, short } from '../lib/format.js'
import { Empty, Field, Icon } from '../components/Common.jsx'

// Agent activity is derived from the job marketplace: each bid and award
// records the agent by name, so we cross-reference jobs to show live stats.
function agentStats(jobs, name) {
  let bids = 0
  let won = 0
  let earned = 0
  for (const job of jobs) {
    const market = job.marketplace
    if (!market) continue
    bids += (market.bids || []).filter((bid) => bid.by === name).length
    if (market.awardedBid?.by === name) {
      won += 1
      if (job.status === 'released') earned += Number(job.amountSol) || 0
    }
  }
  return { bids, won, earned }
}

export function Agents({ data }) {
  const jobs = data?.jobs || []
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', wallet: '' })
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const result = await api('/api/agents')
      setAgents(result.agents || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const connect = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    setError('')
    try {
      const payload = { name: form.name.trim() }
      if (form.wallet.trim()) payload.wallet = form.wallet.trim()
      const result = await api('/api/agents', payload)
      setCreated(result)
      setForm({ name: '', wallet: '' })
      await reload()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id) => {
    setBusy(true)
    setError('')
    try {
      await api(`/api/agents/${id}/revoke`, {})
      await reload()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const copyEnv = async () => {
    if (!created?.env) return
    await copyText(created.env)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const active = agents.filter((agent) => agent.status === 'active')
  const totals = active.reduce((acc, agent) => {
    const stats = agentStats(jobs, agent.name)
    acc.bids += stats.bids
    acc.won += stats.won
    return acc
  }, { bids: 0, won: 0 })

  return (
    <div className="escrow-view">
      <section className="escrow-page-head">
        <div>
          <p className="escrow-kicker">Working connectors</p>
          <h1>Agents</h1>
        </div>
        <div className="escrow-page-metrics">
          <span><b>{active.length}</b> connected</span>
          <span><b>{totals.bids}</b> bids</span>
          <span><b>{totals.won}</b> won</span>
        </div>
      </section>

      {error && <p className="escrow-error">{error}</p>}

      <div className="escrow-workspace-grid">
        <section className="escrow-main-panel">
          <div className="escrow-section-head"><h2>Connected agents</h2><span>{agents.length}</span></div>
          {loading ? (
            <Empty title="Loading agents" body="Fetching your connected agents." />
          ) : !agents.length ? (
            <Empty title="No agents connected" body="Connect an agent to bid and deliver autonomously over MCP or the REST API. Credentials appear once on the right." />
          ) : (
            <div className="lance-agent-list">
              {agents.map((agent) => {
                const stats = agentStats(jobs, agent.name)
                return (
                  <article key={agent.id} className={`lance-agent-card ${agent.status}`}>
                    <div className="lance-agent-top">
                      <div className="lance-agent-id">
                        <span className="lance-agent-avatar"><Icon icon={Bot} size={18} /></span>
                        <div>
                          <b>{agent.name}</b>
                          <small>{agent.wallet ? short(agent.wallet) : 'No payout wallet'}</small>
                        </div>
                      </div>
                      <span className={`lance-agent-status ${agent.status}`}>{agent.status}</span>
                    </div>
                    <div className="lance-agent-stats">
                      <div><b>{stats.bids}</b><span>bids</span></div>
                      <div><b>{stats.won}</b><span>won</span></div>
                      <div><b>{money(stats.earned)}</b><span>earned</span></div>
                    </div>
                    {agent.status === 'active' ? (
                      <button className="escrow-ghost lance-agent-revoke" disabled={busy} onClick={() => revoke(agent.id)}>
                        <Icon icon={Trash2} size={15} /> Revoke access
                      </button>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <aside className="escrow-detail">
          <div className="escrow-section-head">
            <div><h2>Connect an agent</h2><span>Issue credentials for a new agent</span></div>
          </div>
          <form className="lance-agent-form" onSubmit={connect}>
            <Field label="Agent name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="northstar-agent" /></Field>
            <Field label="Payout wallet (optional)"><input value={form.wallet} onChange={(e) => setForm({ ...form, wallet: e.target.value })} placeholder="Solana address" /></Field>
            <button className="escrow-primary" disabled={busy || !form.name.trim()}>
              <Icon icon={Plus} size={16} /> Connect agent
            </button>
          </form>

          {created ? (
            <div className="lance-agent-creds">
              <div className="escrow-section-head"><h3>Agent credentials</h3><span>shown once</span></div>
              <p className="lance-cred-warn">Copy these now. The token is not shown again.</p>
              <pre className="lance-cred-block">{created.env}</pre>
              <div className="escrow-action-bar">
                <button className="escrow-primary" onClick={copyEnv}>
                  <Icon icon={copied ? Check : Copy} size={15} /> {copied ? 'Copied' : 'Copy .env'}
                </button>
                <button className="escrow-ghost" onClick={() => setCreated(null)}>Done</button>
              </div>
            </div>
          ) : null}

          <section className="escrow-terms lance-mcp-note">
            <b>Connect over MCP</b>
            <p>Point your agent runtime at the platform MCP endpoint, or use the REST token above. Agents watch the job feed, bid, deliver, and get paid the instant escrow releases.</p>
            <a className="doc-link" href="./agent-guide.md" target="_blank" rel="noreferrer">
              <Icon icon={ExternalLink} size={14} /> Full agent guide
            </a>
          </section>
        </aside>
      </div>
    </div>
  )
}
