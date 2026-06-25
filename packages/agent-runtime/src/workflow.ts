import type { Workflow, WorkflowStep } from './types.js'

/**
 * DAG-based workflow store. Steps move through:
 * `Pending → Assigned → InProgress → Completed | Failed`.
 *
 * A step becomes "ready" when all entries in its `dependencies` array are `Completed`.
 * The engine itself does not enforce ordering — callers decide when to start a step.
 *
 * All `get`/`list` methods return deep copies so external mutations cannot corrupt internal state.
 */
export class WorkflowEngine {
  private _workflows = new Map<string, Workflow>()

  /** Register a new workflow. Overwrites any existing workflow with the same `id`. */
  create(workflow: Workflow): void {
    this._workflows.set(workflow.id, { ...workflow })
  }

  /** Return a deep copy of the workflow, or `undefined` if not found. */
  get(id: string): Workflow | undefined {
    const w = this._workflows.get(id)
    return w ? { ...w, steps: w.steps.map(s => ({ ...s })) } : undefined
  }

  /** Return deep copies of all registered workflows. */
  list(): Workflow[] {
    return [...this._workflows.values()].map(w => ({ ...w, steps: w.steps.map(s => ({ ...s })) }))
  }

  /** Remove a workflow. Returns `false` if not found. */
  delete(id: string): boolean { return this._workflows.delete(id) }

  /**
   * Assign `agentId` to `stepId` and transition it to `Assigned`.
   * @returns `false` if the workflow or step does not exist.
   */
  assignStep(workflowId: string, stepId: string, agentId: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.assigned_to = agentId
    step.status = 'Assigned'
    return true
  }

  /**
   * Transition `stepId` to `InProgress` and set the workflow status to `"running"`.
   * @returns `false` if the workflow or step does not exist.
   */
  startStep(workflowId: string, stepId: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.status = 'InProgress'
    step.started_at = new Date().toISOString()
    if (wf) wf.status = 'running'
    return true
  }

  /**
   * Transition `stepId` to `Completed` and record its `result`.
   * Automatically sets the workflow to `"completed"` when every step is done.
   * @returns `false` if the workflow or step does not exist.
   */
  completeStep(workflowId: string, stepId: string, result: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.status = 'Completed'
    step.result = result
    step.completed_at = new Date().toISOString()
    if (wf && wf.steps.every(s => s.status === 'Completed')) {
      wf.status = 'completed'
    }
    return true
  }

  /**
   * Transition `stepId` to `Failed`, record the failure `reason`, and mark the workflow `"failed"`.
   * @returns `false` if the workflow or step does not exist.
   */
  failStep(workflowId: string, stepId: string, reason: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.status = 'Failed'
    step.result = reason
    if (wf) wf.status = 'failed'
    return true
  }

  /** Return all workflows currently in `"running"` status. */
  getActive(): Workflow[] {
    return this.list().filter(w => w.status === 'running')
  }

  /**
   * Return all workflows where `agentId` appears in `assigned_agents` or is
   * assigned to at least one step.
   */
  getForAgent(agentId: string): Workflow[] {
    return this.list().filter(w =>
      w.assigned_agents.includes(agentId) ||
      w.steps.some(s => s.assigned_to === agentId)
    )
  }
}
