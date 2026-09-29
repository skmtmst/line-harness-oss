import type { AutomationAction, AutomationEventType } from "./types";

/** オートメーションのきっかけ表示名の正本。 */
export const AUTOMATION_TRIGGER_LABELS: Record<AutomationEventType, string> = {
  friend_add: "友だちが追加されたとき",
  tag_change: "タグが変わったとき",
  score_threshold: "行動スコアが条件に達したとき",
  cv_fire: "成果が記録されたとき",
  message_received: "メッセージが届いたとき",
  postback_received: "メニューが押されたとき",
  calendar_booked: "予約が確定したとき",
  form_submitted: "フォームに回答したとき",
  link_clicked: "リンクが押されたとき",
  datetime: "指定日時になったとき",
  daily: "毎日決まった時刻",
  weekly: "毎週決まった曜日・時刻",
  "ec.order.confirmed": "注文が確定したとき",
  "ec.order.shipped": "発送が完了したとき",
  "ec.subscription.upcoming": "定期便の予定が近づいたとき",
  "ec.subscription.payment_failed": "定期便の決済に失敗したとき",
  "ec.subscription.cancelled": "定期便が解約されたとき",
};

/** オートメーションの処理表示名の正本。実行記録専用の処理も含む。 */
export const AUTOMATION_ACTION_LABELS: Record<string, string> = {
  add_tag: "タグを追加",
  remove_tag: "タグを外す",
  start_scenario: "シナリオを開始",
  send_message: "メッセージを送信",
  send_webhook: "外部連携へ送信",
  switch_rich_menu: "メニューを切り替え",
  update_support_mark: "対応マークを変更",
  add_mileage: "マイルを追加",
  common_action: "共通アクションを実行",
  wait: "指定時間まで待機",
};

export function automationTriggerLabel(eventType: AutomationEventType | string): string {
  return AUTOMATION_TRIGGER_LABELS[eventType as AutomationEventType] ?? "登録したきっかけ";
}

export function automationActionLabel(actionType: AutomationAction["type"] | string): string {
  return AUTOMATION_ACTION_LABELS[actionType] ?? "登録した処理";
}
