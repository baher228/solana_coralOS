import { BASE_NODES, CAMERA_WINDOWS, NODE_H, NODE_W } from './config.js'

const graphDebugLog = []

export function cameraNodes(stepId) {
  return CAMERA_WINDOWS[stepId] || CAMERA_WINDOWS.post
}

function graphBounds(nodeIds) {
  const selected = BASE_NODES.filter(([id]) => nodeIds.includes(id))
  const nodes = selected.length ? selected : BASE_NODES
  return nodes.reduce((bounds, [, x, y]) => ({
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x + NODE_W),
    maxY: Math.max(bounds.maxY, y + NODE_H),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
}

export const graphDebugEnabled = () => new URLSearchParams(location.search).has('graphDebug') || localStorage.getItem('txoddsGraphDebug') === '1'
const rectInfo = (rect) => rect ? {
  left: Math.round(rect.left),
  right: Math.round(rect.right),
  top: Math.round(rect.top),
  bottom: Math.round(rect.bottom),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
} : null
const overlaps = (a, b) => Boolean(a && b && a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom)

function graphSnapshot(label, cameraIds = [], requiredIds = cameraIds) {
  const stage = document.querySelector('.system-stage')?.getBoundingClientRect()
  const guide = document.querySelector('.system-guide-window')?.getBoundingClientRect()
  const side = window.innerWidth > 900 ? document.querySelector('.system-side')?.getBoundingClientRect() : null
  const panel = document.querySelector('.system-panel')?.getBoundingClientRect()
  const activeIds = [...document.querySelectorAll('.system-node.active')]
    .map((node) => node.closest('.react-flow__node')?.getAttribute('data-id'))
    .filter(Boolean)
  const effectiveRequiredIds = requiredIds.length ? requiredIds : activeIds
  const required = new Set(effectiveRequiredIds)
  const nodes = [...document.querySelectorAll('.system-stage .react-flow__node')].map((node) => {
    const rect = node.getBoundingClientRect()
    const id = node.getAttribute('data-id') || ''
    return {
      id,
      rect: rectInfo(rect),
      required: required.has(id),
      visible: rect.width > 0
        && rect.height > 0
        && stage
        && rect.right > stage.left
        && rect.left < stage.right
        && rect.bottom > stage.top
        && rect.top < stage.bottom
        && !overlaps(rect, guide)
        && !overlaps(rect, side)
        && !overlaps(rect, panel),
    }
  })
  return {
    at: new Date().toISOString(),
    label,
    title: document.querySelector('.system-step-copy h2')?.textContent?.trim() || '',
    cameraIds,
    requiredIds: effectiveRequiredIds,
    activeIds,
    stage: rectInfo(stage),
    guide: rectInfo(guide),
    side: rectInfo(side),
    panel: rectInfo(panel),
    transform: getComputedStyle(document.querySelector('.react-flow__viewport') || document.body).transform,
    visible: nodes.filter((node) => node.visible).map((node) => node.id),
    requiredVisible: nodes.filter((node) => node.required && node.visible).map((node) => node.id),
    missingRequired: effectiveRequiredIds.filter((id) => !nodes.some((node) => node.id === id && node.visible)),
    nodes,
  }
}

export function recordGraphDebug(label, cameraIds = [], requiredIds = cameraIds, warn = false) {
  const entry = graphSnapshot(label, cameraIds, requiredIds)
  graphDebugLog.push(entry)
  if (graphDebugLog.length > 80) graphDebugLog.shift()
  window.__txoddsGraphDebug = () => graphDebugLog
  window.__txoddsGraphDump = () => graphSnapshot('manual')
  window.__txoddsGraphLast = entry
  if (graphDebugEnabled()) {
    console.info('[txodds-graph]', entry)
  } else if (warn && entry.missingRequired.length) {
    console.warn('[txodds-graph]', entry)
  }
  return entry
}

function cameraFrame(stageRect) {
  const compact = window.matchMedia('(max-width: 760px)').matches
  const guide = document.querySelector('.system-guide-window')?.getBoundingClientRect()
  const panel = document.querySelector('.system-panel')?.getBoundingClientRect()
  const frame = { left: 0, top: 0, right: stageRect.width, bottom: stageRect.height }

  if (overlaps(guide, stageRect)) {
    if (compact) frame.bottom -= Math.min(stageRect.height - 96, Math.max(0, stageRect.bottom - guide.top + 24))
    else frame.left += Math.min(stageRect.width * 0.42, Math.max(0, guide.right - stageRect.left + 28))
  }

  if (overlaps(panel, stageRect)) {
    frame.top += Math.min(stageRect.height * 0.32, Math.max(0, panel.bottom - stageRect.top + 14))
  }

  return {
    compact,
    left: Math.max(0, frame.left),
    top: Math.max(0, frame.top),
    width: Math.max(260, frame.right - frame.left),
    height: Math.max(120, frame.bottom - frame.top),
  }
}

function cameraViewport(nodeIds) {
  const stage = document.querySelector('.system-stage')
  const rect = stage?.getBoundingClientRect()
  if (!rect?.width || !rect?.height) return null
  const frame = cameraFrame(rect)
  const bounds = graphBounds(nodeIds)
  const spanX = Math.max(1, bounds.maxX - bounds.minX)
  const spanY = Math.max(1, bounds.maxY - bounds.minY)
  const padX = frame.compact ? 34 : 80
  const padY = frame.compact ? 24 : 76
  const minZoom = frame.compact ? 0.22 : 0.35
  const maxZoom = frame.compact ? 0.72 : 0.86
  const fitZoom = Math.min((frame.width - padX * 2) / spanX, (frame.height - padY * 2) / spanY)
  const zoom = Math.min(maxZoom, Math.max(minZoom, fitZoom))
  const alignX = frame.compact ? 0.5 : 0.22
  const alignY = frame.compact ? 0.44 : 0.34
  return {
    x: frame.left + (frame.width - spanX * zoom) * alignX - bounds.minX * zoom,
    y: frame.top + (frame.height - spanY * zoom) * alignY - bounds.minY * zoom,
    zoom,
  }
}

export function focusCamera(instance, nodeIds, reason = 'set', requiredIds = nodeIds) {
  const viewport = cameraViewport(nodeIds)
  if (!viewport) {
    recordGraphDebug(`camera:${reason}:no-viewport`, nodeIds, requiredIds, true)
    return
  }
  requestAnimationFrame(() => {
    void instance.setViewport(viewport, { duration: 0 })
    recordGraphDebug(`camera:${reason}`, nodeIds, requiredIds, true)
    window.setTimeout(() => {
      const entry = recordGraphDebug(`camera:${reason}:settled`, nodeIds, requiredIds, true)
      if (entry.missingRequired.length) {
        void instance.setViewport(viewport, { duration: 0 })
        window.setTimeout(() => recordGraphDebug(`camera:${reason}:retry`, nodeIds, requiredIds, true), 80)
      }
    }, 140)
  })
}
