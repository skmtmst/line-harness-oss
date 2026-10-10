export const HQ_DELIVERY_TEMPLATE_TYPES = ['auto_reply', 'friend_add_rule', 'reminder'] as const;
export type HqDeliveryTemplateType = typeof HQ_DELIVERY_TEMPLATE_TYPES[number];
/** 店の保存入力と同じ設定。店の所属・フォルダは配布時に決める。 */
export interface HqDeliveryTemplateDefinition {
  schemaVersion: 1;
  settings: Record<string, unknown> & { name: string };
  /** 参照を使うときは、配布先にある同じ名前の設定へつなぐ。無い・重複は配らない。 */
  references?: Array<{ sourceId: string; kind: 'tag' | 'template' | 'scenario' | 'form' | 'friend_field' | 'mark' | 'event' | 'reminder' | 'entry_route' | 'common_var' | 'tag_folder' | 'notification_rule'; name: string }>;
}

export type HqAutoReplyDeliverySettings =
  Partial<Omit<import('./types.js').AutoReplyDraftInput, 'lineAccountId' | 'folderId' | 'name'>> &
  Pick<import('./types.js').AutoReplyDraftInput, 'keyword' | 'matchType' | 'responseType' | 'responseContent'> & { name: string };
export type HqReminderDeliverySettings = Omit<import('./types.js').ReminderDraftSettings, 'lineAccountId' | 'folderId'>;
export interface HqFriendAddDeliverySettings {
  name: string; friendKind: 'first_time' | 'returning'; priority: number;
  definition: {
    routeIds: string[]; scenarioId: string | null; messageType: 'text' | 'template' | 'form' | 'scenario';
    messageText: string; timing: 'immediate' | 'scenario'; friendCondition: string;
    actions: Array<{ type: 'add_tag' | 'remove_tag' | 'start_scenario' | 'set_friend_field' | 'add_support_mark' | 'grant_mileage' | 'use_common_var'; label: string; targetId?: string; value?: string; amount?: number; op?: string }>;
    activeFrom: string | null; activeUntil: string | null; internalMemo?: string;
    returningMode?: 'none' | 'same' | 'other'; startPosition?: 'beginning' | 'resume';
    deliveryChoices?: { sendWelcomeMessage: boolean; startScenario: boolean; runActions: boolean };
    resendSuppressionHours?: number | null; unknownRouteAction?: { sendCommonGuidance: boolean; notifyStaff: boolean };
    weekdays?: number[]; timeWindows?: Array<{ start: string; end: string }>;
  };
}
export interface HqDeliveryDefinitionByType {
  auto_reply: HqDeliveryTemplateDefinition & { settings: HqAutoReplyDeliverySettings };
  friend_add_rule: HqDeliveryTemplateDefinition & { settings: HqFriendAddDeliverySettings };
  reminder: HqDeliveryTemplateDefinition & { settings: HqReminderDeliverySettings };
}
export type HqDeliveryTemplateInput = {
  [K in HqDeliveryTemplateType]: { type: K; name: string; description?: string; folderId?: string | null; definition: HqDeliveryDefinitionByType[K]; requestId: string }
}[HqDeliveryTemplateType];
