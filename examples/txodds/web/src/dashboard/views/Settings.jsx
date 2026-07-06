import React, { useState } from 'react'
import { API, api } from '../lib/api.js'
import { formatTime, short } from '../lib/format.js'
import { Empty, Field } from '../components/Common.jsx'

export function Settings({ data, act, refresh }) {
  const [diagnostics, setDiagnostics] = useState(null)
  const [importText, setImportText] = useState('')
  const [agentForm, setAgentForm] = useState({ name: 'demo-worker', wallet: '' })
  const [createdAgent, setCreatedAgent] = useState(null)
  const [demoMcp, setDemoMcp] = useState(null)
  const setAgent = (key) => (e) => setAgentForm({ ...agentForm, [key]: e.target.value })
  const agents = data.agents || []
  const mcpSetup = createdAgent ? [
    `MCP_URL=${API}/mcp`,
    `MCP_AUTH_HEADER=Authorization: Bearer ${createdAgent.token}`,
    '',
    '# REST demo-worker env',
    createdAgent.env,
  ].join('\n') : ''
  const demoMcpSetup = demoMcp ? [
    `MCP_URL=${demoMcp.mcpUrl || `${API}/mcp`}`,
    `MCP_AUTH_HEADER=${demoMcp.authorizationHeader}`,
    `MCP_JOB_ID=${demoMcp.jobId}`,
    '',
    `Target job: ${demoMcp.job?.title || 'Build a live agent checkout page'}`,
    `Max bid: ${demoMcp.job?.amountSol || 0.003} SOL`,
  ].join('\n') : ''

  return (
    <div className="escrow-workspace-grid">
      <section className="escrow-main-panel">
        <div className="escrow-section-head"><h2>Workspace settings</h2><span>{data.setup?.mode}</span></div>
        <p className="escrow-muted">{data.setup?.note}</p>
        <div className="escrow-action-bar">
          <button className="escrow-primary" onClick={() => act(async () => {
            setDemoMcp(null)
            await api('/api/demo/reset', {})
            const next = await api('/api/demo/mcp-session', { restart: true })
            setDemoMcp({
              ...next,
              job: next.jobId ? data.jobs?.find((job) => job.id === next.jobId) : null,
            })
          })}>Start fresh MCP demo job</button>
          <button className="escrow-primary" onClick={() => act(() => api('/api/demo/seed', {}))}>Seed sample contract</button>
          <button className="escrow-ghost" onClick={() => act(() => api('/api/state/reset', {}))}>Reset local jobs</button>
          <button className="escrow-ghost" onClick={refresh}>Reload</button>
          <button className="escrow-ghost" onClick={async () => setDiagnostics(await api('/api/health'))}>Diagnostics</button>
        </div>
        {demoMcp && (
          <div className="escrow-token-box">
            <div className="escrow-section-head">
              <h3>Fresh MCP demo job: {demoMcp.jobId}</h3>
              <button className="escrow-ghost" onClick={() => navigator.clipboard?.writeText(demoMcpSetup)}>Copy setup</button>
            </div>
            <pre>{demoMcpSetup}</pre>
          </div>
        )}
        {diagnostics && <pre>{JSON.stringify(diagnostics, null, 2)}</pre>}
      </section>
      <section className="escrow-main-panel">
        <div className="escrow-section-head"><h2>Connect agent</h2><span>{agents.filter((agent) => agent.status === 'active').length} active</span></div>
        <form className="escrow-create compact" onSubmit={(e) => {
          e.preventDefault()
          act(async () => {
            const created = await api('/api/agents', {
              name: agentForm.name,
              wallet: agentForm.wallet,
            })
            setCreatedAgent(created)
          })
        }}>
          <div className="escrow-form-grid">
            <Field label="Agent name"><input value={agentForm.name} onInput={setAgent('name')} /></Field>
            <Field label="Payout wallet"><input value={agentForm.wallet} onInput={setAgent('wallet')} placeholder="optional if agent sends wallet" /></Field>
          </div>
          <button className="escrow-primary">Create token</button>
        </form>
        {createdAgent && (
          <div className="escrow-token-box">
            <div className="escrow-section-head">
              <h3>MCP API key: {createdAgent.agent.name}</h3>
              <button className="escrow-ghost" onClick={() => navigator.clipboard?.writeText(mcpSetup)}>Copy setup</button>
            </div>
            <pre>{mcpSetup}</pre>
          </div>
        )}
        <div className="escrow-agent-list">
          {agents.length ? agents.map((agent) => (
            <div className="escrow-agent-row" key={agent.id}>
              <span><b>{agent.name}</b><small>{agent.status} - {agent.lastSeenAt ? formatTime(agent.lastSeenAt) : 'never seen'}</small></span>
              <code>{agent.wallet ? short(agent.wallet) : 'wallet optional'}</code>
              {agent.status === 'active'
                ? <button className="escrow-ghost" onClick={() => act(() => api(`/api/agents/${agent.id}/revoke`, {}))}>Revoke</button>
                : <b>Revoked</b>}
            </div>
          )) : <Empty title="No connected agents" body="Create an agent token to let a worker poll jobs, bid, and deliver." />}
        </div>
      </section>
      <section className="escrow-main-panel">
        <div className="escrow-section-head"><h2>Import / export</h2></div>
        <button className="escrow-ghost" onClick={async () => {
          const payload = await api('/api/export')
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'freelance-escrow-platform-export.json'
          a.click()
          URL.revokeObjectURL(a.href)
        }}>Export JSON</button>
        <textarea value={importText} onInput={(e) => setImportText(e.target.value)} placeholder="Paste an export JSON blob" />
        <button className="escrow-primary" disabled={!importText.trim()} onClick={() => act(async () => {
          await api('/api/import', JSON.parse(importText))
          setImportText('')
        })}>Import JSON</button>
      </section>
    </div>
  )
}
