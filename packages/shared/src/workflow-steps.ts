/** Durable workflow status; uncertain external effects require reconciliation. */
export type WorkflowStepStatus = 'pending'|'running'|'succeeded'|'failed'|'exhausted'|'unknown'|'canceled';
export interface QuestionAnswerRecovery {
  executionId:string;
  friendId:string;
  status:WorkflowStepStatus;
  errorCode:string|null;
  updatedAt:string;
}
export interface ResumeQuestionAnswerRequest {
  reason:string;
  /** Required together for legacy answers whose completed effects are unknown. */
  confirmedChoiceIndex?:number;
  confirmedCompletedSteps?:string[];
}
export interface ResumeQuestionAnswerResponse {resumed:boolean;status:WorkflowStepStatus}
