import { MarkerType } from '@xyflow/react'
import { BASE_NODES, EDGES, NODE_H, NODE_W } from './config.js'
import { jobBudget } from './jobs.js'

function graphStepState(step) {
  const active = new Set(step.active || [])
  const complete = new Set(step.complete || [])
  return {
    active,
    complete,
    path: new Set([...active, ...complete]),
  }
}

function graphNodeStatus(id, state) {
  if (state.active.has(id)) return 'active'
  if (state.complete.has(id)) return 'complete'
  return 'idle'
}

function graphEdgeStatus(source, target, state) {
  return state.path.has(source) && state.path.has(target) ? 'active' : 'idle'
}

export function makeGraph(step, brief) {
  const state = graphStepState(step)
  const overrides = {
    employer: { meta: brief.employer, detail: 'Sets scope, budget, and criteria' },
    job: { title: 'Job Brief', meta: brief.title, detail: `${jobBudget(brief)} budget` },
    delivery: { detail: 'Evidence must map back to the brief' },
    artifacts: { detail: 'Checks build, tests, preview, and criteria' },
  }
  const nodes = BASE_NODES.map(([id, x, y, lane, icon, title, meta, detail]) => ({
    id,
    type: 'system',
    position: { x, y },
    initialWidth: NODE_W,
    initialHeight: NODE_H,
    style: { width: NODE_W, minHeight: NODE_H, visibility: 'visible' },
    data: { icon, title, meta, detail, lane, ...overrides[id], state: graphNodeStatus(id, state) },
  }))
  const edges = EDGES.map(([id, source, target]) => ({
    id,
    source,
    target,
    type: 'smoothstep',
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: graphEdgeStatus(source, target, state) === 'active' ? 'flow-edge-active' : 'flow-edge-idle',
  }))
  return { nodes, edges }
}
