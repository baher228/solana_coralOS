import assert from 'node:assert/strict'
import { formatWant } from '@pay/agent-runtime/src/market/protocol.ts'
import { apiBidPayload, chooseBidPrice, deliveryPayload, fallbackNotes, generatedDeliveryHtml, hasAgentBid, isAwardedToAgent, parseFreelanceWant } from './logic.ts'

const want = formatWant({
  round: 7,
  service: 'freelance',
  arg: JSON.stringify({
    id: 'job_demo',
    title: 'Build demo page',
    scope: 'Responsive page with proof',
    acceptanceCriteria: 'Preview URL and notes',
  }),
  budgetSol: 0.01,
})

const parsed = parseFreelanceWant(want)
assert.equal(parsed?.round, 7)
assert.equal(parsed?.job.id, 'job_demo')
assert.equal(chooseBidPrice(0.01, '0.2'), 0.01)
assert.equal(chooseBidPrice(0.01, '0.004'), 0.004)
assert.match(fallbackNotes(parsed!.job), /Build demo page/)
assert.deepEqual(deliveryPayload(7, { url: 'http://127.0.0.1:4177/', notes: 'done' }), {
  round: 7,
  url: 'http://127.0.0.1:4177/',
  notes: 'done',
})
const apiJob = {
  ...parsed!.job,
  amountSol: 0.01,
  status: 'open',
  marketplace: { round: 7, bids: [{ by: 'other-agent' }], awardedBid: { by: 'demo-worker' } },
}
assert.equal(hasAgentBid(apiJob, 'demo-worker'), false)
assert.equal(isAwardedToAgent(apiJob, 'demo-worker'), true)
assert.deepEqual(apiBidPayload(apiJob, 'demo-worker', 'wallet111', '0.004'), {
  round: 7,
  priceSol: 0.004,
  note: 'demo-worker-ready',
  wallet: 'wallet111',
})
const html = generatedDeliveryHtml({ ...parsed!.job, title: 'Build <demo> page' }, 'agent&one')
assert.match(html, /Build &lt;demo&gt; page/)
assert.match(html, /Built by agent&amp;one/)
assert.match(html, /Responsive page with proof/)

console.log('demo-worker self-test passed')
