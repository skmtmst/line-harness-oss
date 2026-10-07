/** 配信には使わない、アカウント単位の書きかけ。新規保存のexpectedVersionは0。 */
export interface ScenarioDraftInput {
  expectedVersion: string | 0;
  content: Record<string, unknown>;
  scenarioId?: string | null;
  stepId?: string | null;
}
export interface ScenarioDraft {
  key: string;
  lineAccountId: string;
  content: Record<string, unknown>;
  scenarioId: string | null;
  stepId: string | null;
  version: string;
  updatedBy: string;
  updatedAt: string;
  expiresAt: string;
}
