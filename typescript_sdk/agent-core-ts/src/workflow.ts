import type { Workflow, WorkflowStep } from './types.js'

export class WorkflowEngine {
  private _workflows = new Map<string, Workflow>()

  create(workflow: Workflow): void {
    this._workflows.set(workflow.id, { ...workflow })
  }

  get(id: string): Workflow | undefined {
    const w = this._workflows.get(id)
    return w ? { ...w, steps: w.steps.map(s => ({ ...s })) } : undefined
  }

  list(): Workflow[] {
    return [...this._workflows.values()].map(w => ({ ...w, steps: w.steps.map(s => ({ ...s })) }))
  }

  delete(id: string): boolean { return this._workflows.delete(id) }

  assignStep(workflowId: string, stepId: string, agentId: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.assigned_to = agentId
    step.status = 'Assigned'
    return true
  }

  startStep(workflowId: string, stepId: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.status = 'InProgress'
    step.started_at = new Date().toISOString()
    if (wf) wf.status = 'running'
    return true
  }

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

  failStep(workflowId: string, stepId: string, reason: string): boolean {
    const wf = this._workflows.get(workflowId)
    const step = wf?.steps.find(s => s.id === stepId)
    if (!step) return false
    step.status = 'Failed'
    step.result = reason
    if (wf) wf.status = 'failed'
    return true
  }

  getActive(): Workflow[] {
    return this.list().filter(w => w.status === 'running')
  }

  getForAgent(agentId: string): Workflow[] {
    return this.list().filter(w =>
      w.assigned_agents.includes(agentId) ||
      w.steps.some(s => s.assigned_to === agentId)
    )
  }
}
