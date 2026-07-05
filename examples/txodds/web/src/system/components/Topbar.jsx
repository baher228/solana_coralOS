import React from 'react'
import {
  ArrowLeft,
  Crosshair,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  StepForward,
} from 'lucide-react'

export function Topbar({
  playing,
  liveEnabled,
  stepIndex,
  totalSteps,
  onTogglePlay,
  onNextStep,
  onReset,
  onLiveEnabled,
  onCenterMap,
  onRefresh,
}) {
  return (
    <header className="system-topbar">
      <a href="./index.html"><ArrowLeft size={18} />Platform</a>
      <div className="system-title">
        <span>Standalone demo</span>
        <h1>Agent Network + Coral Panel Demo</h1>
      </div>
      <div className="system-actions">
        <button onClick={onTogglePlay}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? 'Pause' : 'Play'}</button>
        <button onClick={onNextStep} disabled={stepIndex === totalSteps - 1}><StepForward size={17} />Step</button>
        <button onClick={onReset}><RotateCcw size={17} />Reset</button>
        <label>
          <input
            type="checkbox"
            checked={liveEnabled}
            onChange={(e) => onLiveEnabled(e.target.checked)}
          />
          Live Data
        </label>
        <button onClick={onCenterMap}><Crosshair size={17} />Center map</button>
        <button onClick={onRefresh} disabled={!liveEnabled}><RefreshCw size={17} />Refresh</button>
      </div>
    </header>
  )
}

export function StepSummary({ followLive, followMcp, activeStepIndex, totalSteps, step, script }) {
  return (
    <section className="system-demo-copy">
      <div className="system-step-copy">
        <div className="system-step-line">
          <span>{followLive || followMcp ? 'Live step' : 'Step'} {activeStepIndex + 1} of {totalSteps}</span>
          <b>{activeStepIndex + 1}/{totalSteps}</b>
        </div>
        <h2>{step.title}</h2>
        <p>{step.copy}</p>
      </div>
      <div className="system-step-progress" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }}>
        {script.map((item, index) => (
          <i key={item.id} className={index < activeStepIndex ? 'complete' : index === activeStepIndex ? 'active' : 'idle'} />
        ))}
      </div>
    </section>
  )
}
