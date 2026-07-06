import React, { useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { api } from '../lib/api.js'
import { chatFilterLabels } from '../lib/config.js'
import { formatTime } from '../lib/format.js'
import { chatConversations, conversationFilters } from '../lib/selectors.js'
import { Avatar, Badge, Empty, Icon } from '../components/Common.jsx'

export function Chats({ jobs, selectedId, setSelectedId, act, session }) {
  const [filter, setFilter] = useState('all')
  const [text, setText] = useState('')
  const [threadOpen, setThreadOpen] = useState(false)
  const conversations = chatConversations(jobs, session)
  const filters = conversationFilters(conversations)
  const visible = filters.find(([id]) => id === filter)?.[1] || conversations
  const selectedConversation = conversations.find((item) => item.job.id === selectedId) || visible[0] || conversations[0]
  const job = selectedConversation?.job
  const author = session.role === 'worker' ? 'worker' : 'employer'
  const openThread = (id) => {
    setSelectedId(id)
    setThreadOpen(true)
    setText('')
  }

  return (
    <div className="escrow-view">
      <section className="escrow-page-head">
        <div>
          <p className="escrow-kicker">job conversations</p>
          <h1>Chats</h1>
        </div>
        <div className="escrow-page-metrics">
          <span><b>{conversations.length}</b> threads</span>
          <span><b>{conversations.filter((item) => item.needsReply).length}</b> replies</span>
          <span><b>{conversations.filter((item) => item.review).length}</b> review</span>
        </div>
      </section>
      <div className={`escrow-chat-shell ${threadOpen ? 'open' : ''}`}>
        <section className="escrow-chat-list">
          <div className="escrow-section-head"><div><h2>Inbox</h2><span>Claimed job threads only</span></div><span>{visible.length}</span></div>
          <div className="escrow-chat-filters">
            {filters.map(([id, items]) => (
              <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                {chatFilterLabels[id]} <b>{items.length}</b>
              </button>
            ))}
          </div>
          <div className="escrow-conversation-list">
            {visible.map(({ job: item, last, counterparty: who, needsReply }) => (
              <button
                key={item.id}
                className={`escrow-conversation ${job?.id === item.id ? 'on' : ''}`}
                onClick={() => openThread(item.id)}
              >
                <Avatar name={who} />
                <span>
                  <b>{item.title}</b>
                  <small>{who}</small>
                  <em>{last?.text || 'No messages yet.'}</em>
                </span>
                <i>
                  {needsReply ? <strong>reply</strong> : null}
                  <small>{formatTime(last?.at || item.createdAt)}</small>
                  <Badge status={item.status} />
                </i>
              </button>
            ))}
            {!visible.length && <Empty title="No conversations" body="Claimed jobs with messages will appear here." />}
          </div>
        </section>
        <section className="escrow-chat-pane">
          {job ? (
            <>
              <header className="escrow-chat-head">
                <button className="escrow-ghost escrow-chat-back" onClick={() => setThreadOpen(false)}><Icon icon={ArrowLeft} />Back</button>
                <Avatar name={selectedConversation.counterparty} />
                <div><h2>{job.title}</h2><span>{selectedConversation.counterparty}</span></div>
                <Badge status={job.status} />
              </header>
              <div className="escrow-thread large">
                {job.messages.map((msg, i) => (
                  <p key={i} className={msg.author}><b>{msg.author}</b><span>{msg.text}</span><small>{formatTime(msg.at)}</small></p>
                ))}
                {!job.messages.length && <p className="escrow-muted">No messages yet.</p>}
              </div>
              <form className="escrow-compose large" onSubmit={(e) => {
                e.preventDefault()
                if (!text.trim()) return
                act(async () => {
                  await api(`/api/jobs/${job.id}/messages`, { author, text })
                  setText('')
                })
              }}>
                <input value={text} onInput={(e) => setText(e.target.value)} placeholder={`Message ${selectedConversation.counterparty}`} />
                <button className="escrow-primary" disabled={!text.trim()}><Icon icon={Send} />Send</button>
              </form>
            </>
          ) : <Empty title="Select a conversation" body="Choose a claimed job thread from the inbox." />}
        </section>
      </div>
    </div>
  )
}
