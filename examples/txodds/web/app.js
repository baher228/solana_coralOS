// World Cup Oracle — a captivating React 18 app (no build) over LIVE TxODDS devnet data.
// Talks to the local proxy (../server/proxy.ts: GET /api/board — only fixtures with verified live 1X2
// odds, inlined). If the proxy/token isn't up it shows a clearly-labelled demo board; it never mixes
// demo numbers into a live fixture.

import React, { useState, useEffect } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const PROXY = window.TXODDS_PROXY ?? 'http://localhost:8801'

// ── flags + abbreviations (national teams) ──────────────────────────────────
const FLAGS = {
  brazil: 'br', argentina: 'ar', france: 'fr', england: 'gb-eng', spain: 'es', germany: 'de',
  portugal: 'pt', netherlands: 'nl', italy: 'it', belgium: 'be', croatia: 'hr', uruguay: 'uy',
  'united states': 'us', usa: 'us', mexico: 'mx', japan: 'jp', 'south korea': 'kr', 'korea republic': 'kr',
  senegal: 'sn', morocco: 'ma', switzerland: 'ch', denmark: 'dk', poland: 'pl', serbia: 'rs',
  ecuador: 'ec', ghana: 'gh', cameroon: 'cm', 'saudi arabia': 'sa', australia: 'au', canada: 'ca',
  qatar: 'qa', tunisia: 'tn', wales: 'gb-wls', scotland: 'gb-sct', 'northern ireland': 'gb-nir',
  ireland: 'ie', norway: 'no', sweden: 'se', austria: 'at', 'czech republic': 'cz', czechia: 'cz',
  turkey: 'tr', 'türkiye': 'tr', ukraine: 'ua', colombia: 'co', chile: 'cl', peru: 'pe', paraguay: 'py',
  nigeria: 'ng', egypt: 'eg', algeria: 'dz', 'ivory coast': 'ci', greece: 'gr', hungary: 'hu',
  romania: 'ro', iran: 'ir', china: 'cn', 'costa rica': 'cr', panama: 'pa', jamaica: 'jm',
  'new zealand': 'nz', 'south africa': 'za', slovenia: 'si', slovakia: 'sk', finland: 'fi',
  venezuela: 've', bolivia: 'bo',
}
const ABBR = {
  brazil: 'BRA', argentina: 'ARG', france: 'FRA', england: 'ENG', spain: 'ESP', germany: 'GER',
  portugal: 'POR', netherlands: 'NED', uruguay: 'URU', 'united states': 'USA', mexico: 'MEX',
  serbia: 'SRB', denmark: 'DEN', ecuador: 'ECU', croatia: 'CRO', belgium: 'BEL',
}
const key = (n) => (n || '').trim().toLowerCase()
const flagCode = (n) => FLAGS[key(n)]
const abbr = (n) => ABBR[key(n)] ?? (n || '??').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()

function Flag({ name, size }) {
  const [bad, setBad] = useState(false)
  const code = flagCode(name)
  const big = size === 'big'
  if (bad || !code) return html`<div class=${big ? 'flag-fallback' : 'mc-flag-fb'}>${abbr(name)}</div>`
  return html`<img class=${big ? 'flag' : 'mc-flag'} alt=${name}
    src=${`https://flagcdn.com/${big ? 'w160' : 'w80'}/${code}.png`} onError=${() => setBad(true)} />`
}

// ── demo fallback data (realistic de-margined 1X2) ──────────────────────────
const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString()
const mkt = (pct) => [{ Bookmaker: 'StablePrice', SuperOddsType: '1X2 (de-margined)', PriceNames: ['part1', 'draw', 'part2'], Pct: pct }]
const DEMO_FIXTURES = [
  { FixtureId: 9001, Competition: 'World Cup', Participant1: 'Brazil', Participant2: 'Serbia', StartTime: soon(3) },
  { FixtureId: 9002, Competition: 'World Cup', Participant1: 'Argentina', Participant2: 'Mexico', StartTime: soon(6) },
  { FixtureId: 9003, Competition: 'World Cup', Participant1: 'France', Participant2: 'Denmark', StartTime: soon(27) },
  { FixtureId: 9004, Competition: 'World Cup', Participant1: 'England', Participant2: 'United States', StartTime: soon(30) },
  { FixtureId: 9005, Competition: 'World Cup', Participant1: 'Spain', Participant2: 'Germany', StartTime: soon(51) },
  { FixtureId: 9006, Competition: 'World Cup', Participant1: 'Portugal', Participant2: 'Uruguay', StartTime: soon(54) },
  { FixtureId: 9007, Competition: 'World Cup', Participant1: 'Netherlands', Participant2: 'Ecuador', StartTime: soon(75) },
  { FixtureId: 9008, Competition: 'World Cup', Participant1: 'Croatia', Participant2: 'Belgium', StartTime: soon(78) },
]
const DEMO_ODDS = {
  9001: mkt([62.4, 22.1, 15.5]), 9002: mkt([58.0, 24.5, 17.5]), 9003: mkt([54.2, 26.0, 19.8]),
  9004: mkt([47.5, 27.0, 25.5]), 9005: mkt([41.0, 27.5, 31.5]), 9006: mkt([49.0, 27.0, 24.0]),
  9007: mkt([56.5, 24.0, 19.5]), 9008: mkt([38.0, 28.0, 34.0]),
}
const demoOddsFor = (id) => DEMO_ODDS[id] ?? mkt([45, 27, 28])

// fair (break-even) decimal odds = 100 / implied probability — the price a book must beat for value.
const fairOdds = (pct) => { const p = Number(pct); return Number.isFinite(p) && p > 0 ? 100 / p : NaN }
const fmtOdds = (pct) => { const o = fairOdds(pct); return Number.isFinite(o) ? o.toFixed(2) : '—' }

// client-side fair line + read (used when the proxy/LLM is offline) — mirrors agent/edge.ts
function clientFair(m, teams) {
  const labelOf = { part1: teams.home, part2: teams.away, draw: 'Draw', over: 'Over', under: 'Under' }
  const outcomes = []
  ;(m.PriceNames || []).forEach((name, i) => {
    const pct = Number((m.Pct || [])[i])
    if (Number.isFinite(pct) && pct > 0) outcomes.push({ name, label: labelOf[name] ?? name, pct, fairOdds: Number(fairOdds(pct).toFixed(2)) })
  })
  const favourite = outcomes.reduce((b, o) => (!b || o.pct > b.pct ? o : b), undefined)
  return { outcomes, favourite }
}
function clientRead(fair) {
  const f = fair.favourite
  if (!f) return { call: 'no priced market for this fixture', confidence: 0, note: 'deterministic' }
  const alt = fair.outcomes.filter((o) => o !== f).sort((a, b) => b.pct - a.pct)[0]
  return {
    call: `${f.label} is the verified favourite at ${f.pct.toFixed(0)}% — fair odds ${f.fairOdds.toFixed(2)}${alt ? `; ${alt.label} the main alternative at ${alt.pct.toFixed(0)}%` : ''}.`,
    confidence: Number((f.pct / 100).toFixed(2)), note: 'deterministic (demo)',
  }
}
const clientEdge = (fx) => {
  // prefer the fixture's real inlined odds (live board); only fall back to the demo board offline
  const live = Array.isArray(fx.odds) ? (fx.odds.find((x) => String(x.SuperOddsType ?? '').includes('1X2')) ?? fx.odds.find(hasUsablePct)) : null
  const m = live?.PriceNames ? live : demoOddsFor(fx.FixtureId)[0]
  const teams = { home: fx.Participant1, away: fx.Participant2 }
  const fair = clientFair(m, teams)
  return { fixtureId: String(fx.FixtureId), teams, market: { names: m.PriceNames, pct: m.Pct }, fair, analysis: clientRead(fair), demo: !live }
}
const ESCROW_PROGRAM = 'R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet'
// ≥ the rent-exempt minimum (~0.00089 SOL) so the release makes a brand-new seller account rent-exempt
// in one shot — otherwise the first payout to a fresh wallet is rejected ("insufficient funds for rent").
const SETTLE_SOL = 0.001
const shortAddr = (a) => (a ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : '')
const addrLink = (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`

// ── odds board ──────────────────────────────────────────────────────────────
// LIVE TxODDS markets are messy: Pct values arrive as strings ("41.946"), some priced "NA",
// and many fixtures carry only over/under or Asian-handicap rows with no 1X2. Pick the best
// renderable market — a 1X2 result with usable numbers first, else any market that has at
// least one finite percentage — and treat every percentage as possibly-missing throughout.
const hasUsablePct = (m) =>
  Array.isArray(m?.PriceNames) && m.PriceNames.some((_, i) => Number.isFinite(Number((m.Pct || [])[i])))
function pickMarket(odds) {
  if (!Array.isArray(odds)) return odds
  return odds.find((x) => String(x?.SuperOddsType ?? '').includes('1X2') && hasUsablePct(x))
    ?? odds.find(hasUsablePct)
    ?? null
}

function Board({ fixture, odds, loading }) {
  if (loading) return html`<div class="board"><p class="muted">fetching de-margined odds…</p></div>`
  const m = pickMarket(odds)
  const names = Array.isArray(m?.PriceNames) ? m.PriceNames : null
  if (!names) return html`<div class="board"><p class="muted">No priced market for this fixture yet.</p></div>`
  const pct = names.map((_, i) => Number((m.Pct || [])[i]))
  const labelOf = { part1: fixture.Participant1, draw: 'Draw', part2: fixture.Participant2, over: 'Over', under: 'Under' }
  const cls = { part1: 'home', draw: 'draw', part2: 'away', over: 'home', under: 'away' }
  // favourite = the highest *finite* percentage (indexOf(Math.max) breaks when any price is NaN)
  let favI = -1, favVal = -Infinity
  pct.forEach((p, i) => { if (Number.isFinite(p) && p > favVal) { favVal = p; favI = i } })
  if (favI < 0) return html`<div class="board"><p class="muted">No priced market for this fixture yet.</p></div>`
  const favLabel = labelOf[names[favI]] ?? names[favI]
  const fmt = (p) => (Number.isFinite(p) ? p.toFixed(0) : '—')
  return html`
    <div class="board">
      <div class="board-head"><span>${m.Bookmaker} · ${m.SuperOddsType}</span><span class="bh-cols"><span>fair prob</span><span>fair odds</span></span></div>
      ${names.map((name, i) => html`
        <div class=${'outcome' + (i === favI ? ' fav' : '')} key=${name}>
          <span class="label">${labelOf[name] ?? name}</span>
          <span class="track"><span class=${'fill ' + (cls[name] ?? 'draw')} style=${{ width: `${Number.isFinite(pct[i]) ? Math.min(100, pct[i]) : 0}%` }}></span></span>
          <span class="val">${fmt(pct[i])}%</span>
          <span class="odds">${fmtOdds(pct[i])}</span>
        </div>`)}
      <div class="edge">
        <span class="e-text"><b>${favLabel}</b> — verified favourite at <b>${fmt(pct[favI])}%</b> · fair price <b>${fmtOdds(pct[favI])}</b>
          <div class="e-sub">fair (break-even) odds = 100 ÷ probability — a bet only has value ABOVE this price</div>
        </span>
        <span class="e-cta">txline ${fixture.FixtureId}</span>
      </div>
    </div>`
}

function MatchCard({ fx, on, onSelect }) {
  return html`
    <div class=${'mcard' + (on ? ' on' : '')} onClick=${() => onSelect(fx)}>
      <div class="mc-top">
        <span class="mc-side"><${Flag} name=${fx.Participant1} /><span class="mc-abbr">${abbr(fx.Participant1)}</span></span>
        <span class="mc-vs">vs</span>
        <span class="mc-side r"><${Flag} name=${fx.Participant2} /><span class="mc-abbr">${abbr(fx.Participant2)}</span></span>
      </div>
      <div class="mc-comp"><span class="c">${fx.Competition}</span><span>${new Date(fx.StartTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
    </div>`
}

// the agent's read of the verified fair line (+ the break-even price) — the product being sold
function EdgeCard({ edge }) {
  if (!edge) return html`<div class="edgecard"><p class="muted">reading the fair line…</p></div>`
  const a = edge.analysis || {}
  const fav = edge.fair?.favourite
  const conf = typeof a.confidence === 'number' ? Math.round(a.confidence * 100) : null
  const det = /deterministic/i.test(a.note || '')
  return html`
    <div class="edgecard">
      <div class="ec-head"><span class="ec-tag">agent's read</span>
        <span class=${'ec-badge' + (det ? '' : ' llm')}>${det ? 'deterministic' : 'LLM'}</span></div>
      <p class="ec-call">${a.call}</p>
      ${fav && html`
        <div class="ec-beat">
          <span class="ec-beat-l">price to beat</span>
          <b>${fav.label} @ ${fav.fairOdds.toFixed(2)}</b>
          <span class="ec-beat-s">a bet has value only if a book offers more than this</span>
        </div>`}
      ${conf != null && html`
        <div class="ec-conf"><span>how decisive</span>
          <div class="ec-bar"><div class="ec-fill" style=${{ width: `${conf}%` }}></div></div><b>${conf}%</b></div>`}
      <p class="ec-honest">A read of the <b>verified fair line</b>, not a tip. Calling true "value" needs a sportsbook's
        offered price to compare against — the free TxODDS tier carries only the fair line.</p>
    </div>`
}

// the explainer — what the app actually does, end to end, threaded with the selected fixture's numbers
function Pipeline({ edge, source, settleRes }) {
  const fav = edge?.fair?.favourite
  const steps = [
    { n: 1, title: 'Verified data',
      desc: 'TxODDS de-margined World Cup odds — true-probability estimates with the bookmaker margin stripped out — fetched over a token-gated subscription on Solana devnet.',
      live: fav ? `${fav.label} ${fav.pct.toFixed(0)}%` : (source === 'live' ? 'live' : 'sample') },
    { n: 2, title: 'Fair line + price to beat',
      desc: 'The agent turns each probability into its fair (break-even) decimal odds = 100 ÷ probability — the price a sportsbook must beat for a bet to have value — plus a one-line LLM read.',
      live: fav ? `fair odds ${fav.fairOdds.toFixed(2)}` : '—' },
    { n: 3, title: 'Settled by a neutral arbiter',
      desc: 'The buyer funds a per-order escrow but can’t unilaterally refund — a neutral arbiter program releases to the seller on verified delivery (so neither side can cheat). The escrow reference is bound to the read (sha256), so the on-chain order IS the data bought. Real devnet txs, linked on Explorer.',
      live: settleRes?.ok ? `${settleRes.amountSol} SOL${settleRes.mode === 'arbiter' ? ' · arbiter' : ''}` : `${SETTLE_SOL} SOL` },
  ]
  return html`
    <section class="pipeline">
      <div class="pipe-title">What this does, end to end <span>— verified data → a usable read → paid on-chain</span></div>
      <div class="pipe-steps">
        ${steps.map((s, i) => html`
          <div class="pipe-step" key=${s.n}>
            <div class="pipe-h"><span class="pipe-n">0${s.n}</span><span class="pipe-live">${s.live}</span></div>
            <h4>${s.title}</h4>
            <p>${s.desc}</p>
            ${i < 2 && html`<span class="pipe-arrow">→</span>`}
          </div>`)}
      </div>
    </section>`
}

// the settlement — a real devnet escrow round, linked on Explorer. Two modes: the trustless arbiter
// wrapper (3 parties; the buyer can't unilaterally refund) or the direct buyer-released escrow.
function BindLine({ r }) {
  if (!r.order?.favourite) return null
  return html`
    <div class="settled-line bind">
      <span class="bind-tag">bound</span> this payment references
      <b>${r.order.favourite} @ ${r.order.fairOdds}</b>${r.order.matchup ? ` · ${r.order.matchup}` : ''}
      <span class="bind-ref">ref ${shortAddr(r.reference)} = sha256(${r.order.preimage})</span>
    </div>`
}
function SettleResult({ r }) {
  if (r.ok && r.mode === 'arbiter') return html`
    <div class="settled ok">
      <div class="settled-line">settled <b>${r.amountSol} SOL</b> via the arbiter — buyer
        <a href=${addrLink(r.buyer)} target="_blank" rel="noreferrer">${shortAddr(r.buyer)}</a> funds escrow ·
        arbiter <a href=${addrLink(r.arbiter)} target="_blank" rel="noreferrer">${shortAddr(r.arbiter)}</a> releases
        <span class="settled-arrow">→</span> seller <a href=${addrLink(r.seller)} target="_blank" rel="noreferrer">${shortAddr(r.seller)}</a>
        ${r.selfPay && html`<span class="settled-note">self-pay seller — set a distinct SELLER_WALLET</span>`}
      </div>
      <div class="settled-line trustless">
        <span class="bind-tag arb">trustless</span> the buyer can't take delivery and refund — only the neutral
        arbiter can release, gated on verified delivery, so the seller is protected
      </div>
      <${BindLine} r=${r} />
      <div class="settled-line links">
        <a href=${r.open.explorer} target="_blank" rel="noreferrer">open ↗</a> ·
        <a href=${r.release.explorer} target="_blank" rel="noreferrer">arbiter release ↗</a> ·
        <a href=${r.escrow.explorer} target="_blank" rel="noreferrer">escrow PDA ↗</a>
      </div>
    </div>`
  if (r.ok) return html`
    <div class="settled ok">
      <div class="settled-line">settled <b>${r.amountSol} SOL</b> on devnet — buyer
        <a href=${addrLink(r.buyer)} target="_blank" rel="noreferrer">${shortAddr(r.buyer)}</a>
        <span class="settled-arrow">→</span> seller
        <a href=${addrLink(r.seller)} target="_blank" rel="noreferrer">${shortAddr(r.seller)}</a>
        ${r.selfPay && html`<span class="settled-note">self-pay — set a distinct SELLER_WALLET to split the parties</span>`}
      </div>
      <${BindLine} r=${r} />
      <div class="settled-line links">
        <a href=${r.deposit.explorer} target="_blank" rel="noreferrer">deposit ↗</a> ·
        <a href=${r.release.explorer} target="_blank" rel="noreferrer">release ↗</a> ·
        <a href=${r.escrow.explorer} target="_blank" rel="noreferrer">escrow PDA ↗</a>
      </div>
    </div>`
  return html`
    <div class="settled sim">live settle unavailable${r.error ? ` (${String(r.error).slice(0, 70)})` : ''} —
      needs a funded devnet buyer wallet (.env). See the
      <a href=${addrLink(ESCROW_PROGRAM)} target="_blank" rel="noreferrer">escrow program ↗</a></div>`
}

function App() {
  const [fixtures, setFixtures] = useState(null)
  const [source, setSource] = useState(null) // 'live' | 'demo'
  const [idx, setIdx] = useState(0)
  const [odds, setOdds] = useState(null)
  const [loadingOdds, setLoadingOdds] = useState(false)
  const [edge, setEdge] = useState(null)
  const [settleRes, setSettleRes] = useState(null)
  const [settling, setSettling] = useState(false)
  const selected = fixtures ? fixtures[idx] : null

  // load the board: fixtures with verified live odds (inlined). The free World Cup tier's odds are
  // intermittent and the proxy needs a few seconds to subscribe on a cold start, so we KEEP polling
  // until live data arrives — showing the labelled sample board meanwhile, then switching to live on
  // its own. We never mix demo numbers into a live fixture.
  useEffect(() => {
    let alive = true
    let timer = null
    let tries = 0
    const load = () => {
      fetch(`${PROXY}/api/board`).then((r) => r.json()).then((d) => {
        if (!alive) return
        if (Array.isArray(d) && d.length) { setFixtures(d); setSource('live'); setIdx(0); return }
        throw new Error('no live fixtures yet')
      }).catch(() => {
        if (!alive) return
        setFixtures((f) => f ?? DEMO_FIXTURES)   // keep the board full while we wait
        setSource((s) => (s === 'live' ? s : 'demo'))
        if (tries++ < 30) timer = setTimeout(load, 5000) // live odds can return at any time
      })
    }
    load()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  // odds come inlined on live fixtures (from /api/board); demo fixtures use the baked-in board.
  useEffect(() => {
    if (!selected) return
    setLoadingOdds(false)
    setOdds(Array.isArray(selected.odds) ? selected.odds : demoOddsFor(selected.FixtureId))
  }, [idx, fixtures])

  // the agent delivers its call, then the buyer escrow fires automatically (Option A — no button).
  // Live → the proxy's /api/edge (real odds → real call) → /api/settle (real devnet deposit→release);
  // demo → a client-side call only (no wallet flow). Never invents data for an empty game.
  useEffect(() => {
    if (!selected) return
    let alive = true
    setEdge(null); setSettleRes(null); setSettling(false)
    ;(async () => {
      // 1) the agent's call
      let e = clientEdge(selected)
      if (source === 'live') {
        try {
          const d = await (await fetch(`${PROXY}/api/edge?fixtureId=${selected.FixtureId}`)).json()
          if (d && d.analysis) e = d
        } catch { /* keep the client-side call */ }
      }
      if (!alive) return
      setEdge(e)
      // 2) delivery → settlement fires on its own; the Explorer links appear when it confirms
      if (source !== 'live') return
      setSettling(true)
      try {
        const s = await (await fetch(`${PROXY}/api/settle?fixtureId=${selected.FixtureId}&amount=${SETTLE_SOL}`)).json()
        if (alive) setSettleRes(s)
      } catch (err) {
        if (alive) setSettleRes({ ok: false, error: String(err) })
      } finally {
        if (alive) setSettling(false)
      }
    })()
    return () => { alive = false }
  }, [idx, fixtures])

  const select = (fx) => setIdx(fixtures.findIndex((f) => f.FixtureId === fx.FixtureId))

  return html`
    <header class="hero">
      <span class=${'kicker' + (source === 'demo' ? ' demo' : '')}>
        <span class="dot"></span>${source === 'demo' ? 'sample fixtures · live odds quiet' : 'live · devnet · free World Cup tier'}
      </span>
      <h1>World Cup Oracle</h1>
      <p class="tagline">An agent sells <b>verified</b> TxODDS odds: it fetches the de-margined fair line on Solana devnet,
        turns it into <b>fair (break-even) odds + a plain read</b>, and gets paid through an on-chain escrow.</p>
    </header>
    <main>
      <${Pipeline} edge=${edge} source=${source} settleRes=${settleRes} />
      ${!fixtures && html`<p class="muted" style=${{ textAlign: 'center' }}>loading fixtures…</p>`}
      ${selected && html`
        <section class="featured">
          <div class="feat-top">
            <span class="chip">${selected.Competition}</span>
            <span class="feat-when">kickoff ${new Date(selected.StartTime).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="matchup">
            <div class="team home"><${Flag} name=${selected.Participant1} size="big" /><span class="team-name">${selected.Participant1}</span></div>
            <div class="vs">VS</div>
            <div class="team away"><${Flag} name=${selected.Participant2} size="big" /><span class="team-name">${selected.Participant2}</span></div>
          </div>
          <${Board} fixture=${selected} odds=${odds} loading=${loadingOdds} />
          <div class="thesis">
            <${EdgeCard} edge=${edge} />
            <div class="settle-row">
              ${settling && html`<div class="settling-auto">
                <span class="spin"></span> agent delivered — arbiter settling ${SETTLE_SOL} SOL in escrow on devnet…
              </div>`}
              ${settleRes && html`<${SettleResult} r=${settleRes} />`}
            </div>
          </div>
        </section>`}

      <h3 class="grid-title">All fixtures — tap a match</h3>
      <div class="grid">
        ${fixtures?.map((fx) => html`<${MatchCard} key=${fx.FixtureId} fx=${fx} on=${selected?.FixtureId === fx.FixtureId} onSelect=${select} />`)}
      </div>
    </main>
    <footer class="foot">
      <p class="pillars">Verified <b>TxODDS</b> fair line · the agent's <b>break-even read</b> · settled by <b>Solana escrow</b>.</p>
      <p>${source === 'live'
        ? `live · devnet · ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'} with verified odds`
        : source === 'demo'
          ? 'live World Cup odds are quiet right now — showing sample fixtures; the board switches to live automatically when they return'
          : 'connecting to the live proxy…'}</p>
    </footer>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
