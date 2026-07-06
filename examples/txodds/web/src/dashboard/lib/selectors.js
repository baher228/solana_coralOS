import { terminal } from './config.js'
import { money, party, short } from './format.js'

export function isTerminal(job) {
  return job && terminal.has(job.status)
}

export function isOpen(job) {
  return job?.status === 'open'
}

export function canClaim(job, session) {
  return isOpen(job) && session?.role === 'worker'
}

export function canWork(job) {
  return job && !isOpen(job) && !isTerminal(job) && job.status !== 'disputed'
}

export function canSubmitWork(job, session) {
  return canWork(job) && session?.role === 'worker' && job.worker === session.organization
}

export function canReviewWork(job, session) {
  return canWork(job) && session?.role === 'employer' && job.employer === session.organization && Boolean(job.submission)
}

export function isJobParty(job, session) {
  return Boolean(job && session && (job.employer === session.organization || job.worker === session.organization))
}

export function activeDispute(job) {
  return (job?.disputes || []).find((dispute) => dispute.status === 'open')
}

export function counterparty(job, session) {
  if (!job || !session) return 'Counterparty'
  return session.role === 'worker' ? party(job.employer) : party(job.worker || 'Unassigned worker')
}

export function isReviewStatus(job) {
  return ['submitted', 'revision_requested', 'disputed'].includes(job?.status)
}

export function lastItem(items) {
  return items?.length ? items[items.length - 1] : null
}

export function jobSections(jobs, session) {
  const org = session?.organization
  const partyJobs = jobs.filter((job) => isJobParty(job, session))
  const openTasks = jobs.filter(isOpen)
  const review = partyJobs.filter(isReviewStatus)
  const completed = partyJobs.filter(isTerminal)
  return session?.role === 'worker'
    ? [
      ['working', 'Working on', 'Claimed jobs assigned to you', partyJobs.filter((job) => job.worker === org && !isOpen(job) && !isTerminal(job))],
      ['available', 'Available', 'Open jobs ready to claim', openTasks],
      ['review', 'In review', 'Submitted, disputed, or revision work', review],
      ['completed', 'Completed', 'Released, refunded, or cancelled jobs', completed],
    ]
    : [
      ['posted', 'Posted', 'Jobs posted by your organization', jobs.filter((job) => job.employer === org)],
      ['available', 'Open market', 'Open jobs from other teams', openTasks.filter((job) => job.employer !== org)],
      ['review', 'In review', 'Submitted, disputed, or revision work', review],
      ['completed', 'Completed', 'Released, refunded, or cancelled jobs', completed],
    ]
}

export function chatConversations(jobs, session) {
  const replyAuthor = session?.role === 'worker' ? 'employer' : 'worker'
  return jobs
    .filter((job) => !isOpen(job) && isJobParty(job, session))
    .map((job) => {
      const last = lastItem(job.messages)
      return {
        job,
        last,
        counterparty: counterparty(job, session),
        needsReply: last?.author === replyAuthor,
        active: !isTerminal(job),
        review: isReviewStatus(job),
        completed: isTerminal(job),
        at: last?.at || job.submission?.at || job.createdAt,
      }
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

export function conversationFilters(conversations) {
  return [
    ['all', conversations],
    ['active', conversations.filter((item) => item.active)],
    ['needsReply', conversations.filter((item) => item.needsReply)],
    ['review', conversations.filter((item) => item.review)],
    ['completed', conversations.filter((item) => item.completed)],
  ]
}

export function userBalance(data, session) {
  const role = session?.role === 'worker' ? 'worker' : 'employer'
  const wallets = data.setup?.wallets || {}
  return {
    role,
    address: wallets[role],
    balance: wallets.balances?.[`${role}Sol`],
  }
}

export function transactionImpact(job, event, session) {
  const amount = money(job.amountSol)
  if (event.type === 'released') return session?.role === 'worker' ? `+${amount}` : `-${amount}`
  if (event.type === 'refunded') return session?.role === 'employer' ? `+${amount}` : `-${amount}`
  if (event.type === 'funded') return session?.role === 'employer' ? `-${amount}` : `${amount} locked`
  return amount
}

export function walletTransactions(jobs, session) {
  return jobs
    .filter((job) => isJobParty(job, session))
    .flatMap((job) => (job.settlement?.events || []).map((event, index) => ({
      id: `${job.id}-${event.type}-${event.at}-${index}`,
      job,
      event,
      impact: transactionImpact(job, event, session),
    })))
    .sort((a, b) => String(b.event.at || '').localeCompare(String(a.event.at || '')))
}

export function preferredJobId(jobs, session) {
  const org = session?.organization
  const preferred = session?.role === 'worker'
    ? jobs.find((job) => job.worker === org && !isOpen(job)) || jobs.find((job) => job.status === 'open')
    : jobs.find((job) => job.employer === org) || jobs.find((job) => job.status === 'open')
  return preferred?.id || jobs[0]?.id || ''
}
