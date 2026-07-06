import React from 'react'
import { ChevronDown } from 'lucide-react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { api } from '../lib/api.js'
import { formatTime, money, moneyMaybe, statusText } from '../lib/format.js'
import { isJobParty, isOpen, isTerminal, userBalance, walletTransactions } from '../lib/selectors.js'
import { Empty, Icon } from '../components/Common.jsx'
import { DetailPanel } from './Jobs.jsx'

export function TransactionRow({ tx, selectedId, setSelectedId }) {
  const { job, event, impact } = tx
  return (
    <Collapsible.Root className={`escrow-transaction ${selectedId === job.id ? 'on' : ''}`}>
      <Collapsible.Trigger asChild>
        <button className="escrow-transaction-trigger" onClick={() => setSelectedId(job.id)}>
          <span><b>{statusText(event.type)}</b><small>{job.title}</small></span>
          <span><b>{impact}</b><small>{formatTime(event.at)}</small></span>
          <Icon icon={ChevronDown} />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="escrow-transaction-breakdown">
      <dl>
        <div><dt>Summary</dt><dd>{event.summary}</dd></div>
        <div><dt>Escrow</dt><dd>{job.settlement.escrow}</dd></div>
        <div><dt>Reference</dt><dd>{job.reference}</dd></div>
        <div><dt>Mode</dt><dd>{job.settlement.mode}</dd></div>
        <div><dt>Worker wallet</dt><dd>{job.settlement.devnet?.seller || '--'}</dd></div>
        <div><dt>Deposit</dt><dd>{job.settlement.devnet?.deposit || '--'}</dd></div>
        <div><dt>Release</dt><dd>{job.settlement.release || '--'}</dd></div>
        <div><dt>Refund</dt><dd>{job.settlement.refund || '--'}</dd></div>
        <div><dt>Status</dt><dd>{statusText(job.status)}</dd></div>
      </dl>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

export function WalletView({ data, selected, selectedId, setSelectedId, session, act }) {
  const account = userBalance(data, session)
  const transactions = walletTransactions(data.jobs || [], session)
  const selectedJob = isJobParty(selected, session) ? selected : transactions[0]?.job
  return (
    <div className="escrow-view">
      <section className="escrow-page-head">
        <div>
          <p className="escrow-kicker">{data.setup?.mode || 'local-demo'}</p>
          <h1>Wallet</h1>
        </div>
        <div className="escrow-page-metrics">
          <span><b>{moneyMaybe(account.balance)}</b> balance</span>
          <span><b>{money(data.summary?.lockedSol)}</b> locked</span>
          <span><b>{transactions.length}</b> txns</span>
        </div>
      </section>
      <div className="escrow-workspace-grid">
        <section className="escrow-main-panel">
          <div className="escrow-section-head"><div><h2>Transactions</h2><span>Click any row for the settlement breakdown</span></div><span>{transactions.length}</span></div>
          <div className="escrow-transactions">
            {transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} selectedId={selectedId} setSelectedId={setSelectedId} />)}
            {!transactions.length && <Empty title="No wallet activity" body="Settlement events appear here after jobs are funded, reviewed, released, refunded, or cancelled." />}
          </div>
          {selectedJob ? (
            <div className="escrow-action-bar wallet">
              <button className="escrow-ghost" disabled={isTerminal(selectedJob) || isOpen(selectedJob)} onClick={() => act(() => api(`/api/jobs/${selectedJob.id}/refund`, {}))}>Refund selected escrow</button>
              <button className="escrow-ghost" disabled={isTerminal(selectedJob) || selectedJob.submission} onClick={() => act(() => api(`/api/jobs/${selectedJob.id}/cancel`, {}))}>Cancel selected escrow</button>
            </div>
          ) : null}
        </section>
        <DetailPanel job={selectedJob} session={session} act={act} />
      </div>
    </div>
  )
}
