import React from 'react'
import { Background, Handle, Panel, Position, ReactFlow } from '@xyflow/react'

function SystemNode({ data }) {
  const Icon = data.icon
  return (
    <div className={`system-node ${data.state}`}>
      <Handle type="target" position={Position.Left} />
      <span className="node-lane">{data.lane}</span>
      <div className="node-head">
        <span><Icon size={18} /></span>
        <b>{data.title}</b>
      </div>
      <p>{data.meta}</p>
      <small>{data.detail}</small>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { system: SystemNode }

function Metric({ label, value }) {
  return <div className="system-metric"><span>{label}</span><b>{value}</b></div>
}

export function SystemMap({ graph, metrics, onInit, onJobNodeClick }) {
  return (
    <section className="system-stage">
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView={false}
        defaultViewport={{ x: 70, y: 180, zoom: 1 }}
        minZoom={0.14}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        onlyRenderVisibleElements={false}
        proOptions={{ hideAttribution: true }}
        onInit={onInit}
        onNodeClick={(_, node) => {
          if (node.id === 'job') onJobNodeClick()
        }}
      >
        <Background color="#d7d1c2" gap={22} />
        <Panel position="top-left" className="system-panel">
          <Metric label="Budget" value={metrics.budget} />
          <Metric label="Winning bid" value={metrics.bid} />
          <Metric label="Escrow" value={metrics.escrow} />
          <Metric label="Review" value={metrics.review} />
          <Metric label="Settlement" value={metrics.settlement} />
        </Panel>
        <Panel position="bottom-left" className="system-lanes">
          <b>Marketplace</b><b>Agent Network</b><b>Escrow</b><b>Review</b><b>Settlement</b>
        </Panel>
      </ReactFlow>
    </section>
  )
}
