
export class WorkflowDeferred extends Error {
  constructor(public readonly state: string) { super(`workflow_${state}`); }
}
