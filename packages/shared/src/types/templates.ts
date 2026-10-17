/** テンプレ使用箇所一覧 */
export interface TemplateUsages {
  autoReplies: Array<{
    id: string;
    keyword: string;
    lineAccountId: string | null;
  }>;
  scenarioSteps: Array<{
    scenarioId: string;
    scenarioName: string;
    stepId: string;
    stepOrder: number;
  }>;
  automations: Array<{ id: string; name: string; eventType: string }>;
  reminderSteps: Array<{ reminderId: string; reminderName: string; stepId: string }>;
  richMenuAreas: Array<{
    groupId: string;
    groupName: string;
    pageName: string;
    areaId: string;
    label: string | null;
  }>;
  trackedLinks: Array<{ id: string; name: string }>;
}

// -----------------------------------------------------------------------------
// テンプレート (Template)
// -----------------------------------------------------------------------------

export interface Template extends Partial<import('../style-api.js').StyleSampleMetadata> {
  id: string;
  name: string;
  category: string;
  messageType: string;
  messageContent: string;
  /** 置き場。未分類は null。 */
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}
