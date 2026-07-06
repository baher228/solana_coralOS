import React, { useEffect, useState } from 'react'
import { DEFAULT_ACCOUNTS } from '../lib/config.js'
import { loadAccounts } from '../lib/api.js'
import { accountDraft } from '../lib/format.js'
import { saveSession } from '../lib/session.js'
import { Field } from './Common.jsx'

export function Login({ onLogin }) {
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS)
  const [form, setForm] = useState(() => accountDraft(DEFAULT_ACCOUNTS[0]))
  const set = (key) => (e) => setForm({ ...form, accountId: 'custom', [key]: e.target.value })
  const selectAccount = (account) => setForm(accountDraft(account))
  const submit = (e) => {
    e.preventDefault()
    const session = {
      ...form,
      name: form.name.trim() || 'Ava Hart',
      email: form.email.trim() || 'ava@northstar.test',
      organization: form.organization.trim() || 'Northstar Studio',
      signedInAt: new Date().toISOString(),
    }
    saveSession(session)
    onLogin(session)
  }
  useEffect(() => {
    let active = true
    loadAccounts().then((next) => { if (active) setAccounts(next) })
    return () => { active = false }
  }, [])
  return (
    <main className="escrow-login">
      <section className="escrow-login-copy">
        <div className="escrow-mark">FE</div>
        <p className="escrow-kicker">Freelance Escrow Platform</p>
        <h1>Post tasks, claim work, and settle payouts in one workspace.</h1>
        <div className="escrow-login-ledger">
          <div><span>Open tasks</span><b>24</b></div>
          <div><span>In review</span><b>4</b></div>
          <div><span>Settled</span><b>92%</b></div>
        </div>
      </section>
      <form className="escrow-login-form" onSubmit={submit}>
        <div>
          <p className="escrow-kicker">Sign in</p>
          <h2>Open your escrow workspace</h2>
        </div>
        <section className="escrow-test-accounts">
          <div className="escrow-section-head"><h3>Test accounts</h3><span>{accounts.length}</span></div>
          <div className="escrow-account-grid">
            {accounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={`escrow-account-card ${form.accountId === account.id ? 'on' : ''}`}
                onClick={() => selectAccount(account)}
              >
                <span>{account.role}</span>
                <b>{account.organization}</b>
                <small>{account.name}</small>
              </button>
            ))}
          </div>
        </section>
        <Field label="Full name"><input value={form.name} onInput={set('name')} autoComplete="name" /></Field>
        <Field label="Email"><input type="email" value={form.email} onInput={set('email')} autoComplete="email" /></Field>
        <Field label="Organization"><input value={form.organization} onInput={set('organization')} /></Field>
        <div className="escrow-role-picker" role="group" aria-label="Account role">
          {['employer', 'worker'].map((role) => (
            <button
              key={role}
              type="button"
              className={form.role === role ? 'on' : ''}
              onClick={() => setForm({ ...form, accountId: 'custom', role })}
            >
              {role}
            </button>
          ))}
        </div>
        <button className="escrow-primary">Continue</button>
        <a href="./legacy.html">Open legacy demo</a>
      </form>
    </main>
  )
}
