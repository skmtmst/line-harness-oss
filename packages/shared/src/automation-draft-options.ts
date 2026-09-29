/**
 * 下書きで選べるきっかけ・処理の正本(#734)。
 *
 * 動くものだけを並べる。下書きunion(`apps/worker/src/services/automation-drafts.ts`
 * の `AutomationDraftTriggerType` / `AutomationDraftActionType`)と一致させ、
 * 新規作成(`apps/web/src/app/automations/new/page.tsx`)と下書き編集
 * (`apps/web/src/components/automations/automation-draft-editor.tsx`)の
 * 両方がここから描画する。片方だけ直してもう片方に届かない事故を防ぐ。
 *
 * 表示名の正本(`automation-labels.ts`)とは別物。あちらは型全17件の表示名で
 * 未知値のフォールバックを持つため、「選ばせてよいものの一覧」にはならない。
 */
export interface AutomationDraftTriggerOption {
  value: string;
  label: string;
  /**
   * このきっかけの設定欄。下書き保存時に残す鍵。
   * 空なら設定なし。鍵の意味と検証は `validateTriggerConfig` が正本。
   */
  configKeys: readonly string[];
}

export const AUTOMATION_DRAFT_TRIGGER_OPTIONS: readonly AutomationDraftTriggerOption[] = [
  { value: 'friend_add', label: '友だちになったとき', configKeys: [] },
  { value: 'message_received', label: 'メッセージを受け取ったとき', configKeys: ['keyword'] },
  { value: 'tag_change', label: 'タグが付いた・外れたとき', configKeys: ['tagId', 'action'] },
  { value: 'form_submitted', label: 'フォームに回答したとき', configKeys: ['formId'] },
  { value: 'link_clicked', label: 'リンクが押されたとき', configKeys: ['trackedLinkId'] },
  { value: 'calendar_booked', label: '予約が確定したとき', configKeys: ['bookingType', 'menuId', 'eventId'] },
  { value: 'datetime', label: '決めた時刻になったとき', configKeys: ['at', 'friendIds'] },
  { value: 'daily', label: '毎日決まった時刻', configKeys: ['time', 'friendIds'] },
  { value: 'weekly', label: '毎週決まった曜日・時刻', configKeys: ['time', 'weekdays', 'friendIds'] },
  { value: 'ec.order.confirmed', label: '注文が確定したとき', configKeys: [] },
];

export interface AutomationDraftActionOption {
  value: string;
  label: string;
}

export const AUTOMATION_DRAFT_ACTION_OPTIONS: readonly AutomationDraftActionOption[] = [
  { value: 'add_tag', label: 'タグを付ける' },
  { value: 'start_scenario', label: 'シナリオを始める' },
  { value: 'send_message', label: 'メッセージを送る' },
  // #942 N-356: 公開済みの共通アクションを呼ぶ。実行時に版が固定される。
  { value: 'common_action', label: '共通アクションを実行' },
];
