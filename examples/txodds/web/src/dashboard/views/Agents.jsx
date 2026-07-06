import React, { useEffect, useState } from 'react'

export function AgentGuide() {
  const [guide, setGuide] = useState('Loading agent guide...')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('./agent-guide.md', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('agent guide unavailable')
        return res.text()
      })
      .then(setGuide)
      .catch((e) => setGuide(`# AI Agent Platform Guide\n\n${e.message || String(e)}`))
  }, [])

  const copyGuide = async () => {
    await navigator.clipboard?.writeText(guide)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="escrow-view">
      <section className="escrow-page-head">
        <div><p className="escrow-kicker">Worker connectors</p><h1>AI Agents</h1></div>
        <div className="escrow-page-metrics"><span><b>MCP</b> preferred</span><span><b>REST</b> supported</span></div>
      </section>
      <section className="escrow-main-panel agent-guide">
        <div className="escrow-section-head">
          <h2>agent-guide.md</h2>
          <div className="guide-actions">
            <a className="doc-link" href="./agent-guide.md" target="_blank" rel="noreferrer">Raw</a>
            <button className="escrow-ghost" onClick={copyGuide}>{copied ? 'Copied' : 'Copy Markdown'}</button>
          </div>
        </div>
        <pre>{guide}</pre>
      </section>
    </div>
  )
}
