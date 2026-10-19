/**
 * 送信経路の台帳（IDEA-32 / #1050）。
 *
 * 「緊急停止ボタンが見える」ことと「各送信経路が停止状態を見ている」ことは
 * 別の事実である。このファイルは、外部へ届く実装レベルの送信経路を1行ずつ
 * 挙げ、どの停止対象 (OPERATION_CAPABILITIES) で止まるか、どのコードが
 * その直前に状態を読むかを対応づける。
 *
 * - `capability` が値を持つ経路は、外部呼び出しの直前に
 *   `isOperationCapabilityStopped` (または同等の経路側チェック) で
 *   止まることが契約。`enforcement` の {file, marker} はその証跡で、
 *   契約テスト (operation-send-paths.test.ts) が文字の存在を検査する。
 * - `capability: null` は緊急停止の対象外と判断した経路。理由を
 *   `excludedReason` に必ず書く（画面・監査で同じ文を出す）。
 *
 * 新しい送信経路を足すときは、ここに1行足してから実装する。
 * 経路を止める/止めないの判断を変えるときは、この表と UI の説明を
 * 同時に直す。
 */
import {
  OPERATION_CAPABILITIES,
  type OperationCapability,
} from '@line-crm/db';


export type OperationSendPathKind =
  /** 担当者が相手を見て送る手動送信。 */
  | 'manual'
  /** イベントや条件に反応して動く自動送信。 */
  | 'auto'
  /** cron / 予約時刻で動く送信。 */
  | 'scheduled'
  /** LINE Harness Proxy (/line-api) を通る送信。 */
  | 'proxy'
  /** LINE 以外の外部サービスへの送信。 */
  | 'external';

export interface OperationSendPath {
  /** 台帳・テスト・画面で共通の安定ID。 */
  id: string;
  /** 運用者向けの名前。 */
  label: string;
  kind: OperationSendPathKind;
  /**
   * 止める緊急停止の対象。null は「対象外」と判断した経路で、
   * そのときは excludedReason が必須。
   */
  capability: OperationCapability | null;
  /**
   * 外部送信の直前に停止状態を読む場所の証跡。
   * marker はそのファイルに必ず存在する文字列
   * （例: `'reminder_dispatch'` / `isOperationCapabilityStopped`）。
   * 対象外の経路は空配列でよい。
   */
  enforcement: Array<{ file: string; marker: string }>;
  /** capability が null のときの理由（運用者向けの文）。 */
  excludedReason?: string;
  /** 補足。停止中の行の扱い（queued のまま保持、replyToken は持たない等）。 */
  note?: string;
}

/**
 * LINE Messaging API へ出す push のうち、緊急停止の対象として扱う
 * 経路別の停止キーを proxy へ伝えるヘッダ。
 *
 * 未指定の push / multicast / broadcast / narrowcast は従来どおり
 * `broadcast_dispatch` で止める（値の無い古い呼び出しは一斉送信扱い
 * = 安全側）。`manual` の印 (X-Line-Harness-Source: manual) が付く
 * 1:1 push は従来どおり全停止対象の外。
 */
export const OPERATION_PROXY_CAPABILITY_HEADER = 'X-Line-Harness-Capability';

export const OPERATION_SEND_PATHS: readonly OperationSendPath[] = [
  {
    id: 'restaurant-phone-confirmation',
    label: '電話予約のLINE確認通知',
    kind: 'auto',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/restaurant-line-confirmation.ts', marker: "'broadcast_dispatch'" },
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '担当者が登録した予約の自動通知。停止中は送らず理由を返し、予約そのものは保存する。',
  },
  // ----------------------------------------------------------
  // 一斉配信 (broadcast_dispatch)
  // ----------------------------------------------------------
  {
    id: 'broadcast-send',
    label: '一斉配信（予約・今すぐ送信・分割送信）',
    kind: 'scheduled',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/broadcasts/broadcast.ts', marker: "isOperationCapabilityStopped(db, ownerAccountId, 'broadcast_dispatch')" },
      { file: 'apps/worker/src/services/dedup-broadcast.ts', marker: "'broadcast_dispatch'" },
      { file: 'apps/worker/src/routes/broadcasts.ts', marker: "'broadcast_dispatch'" },
    ],
    note: '一度に送る分が切り替わるところで止まります。停止中に時刻を過ぎた予約は再開時に下書きへ戻し、まとめて送りません。',
  },
  {
    id: 'nen-deliveries',
    label: 'キャンペーンの一斉案内',
    kind: 'scheduled',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/nen-engagement.ts', marker: "'broadcast_dispatch'" },
    ],
    note: '一斉配信の停止に合わせて止まります。待っている案内はそのまま残ります。',
  },
  {
    id: 'line-proxy-automated',
    label: '外部サービスからの自動配信',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '外部サービスから送る自動メッセージも、一斉配信の停止に合わせて止まります。',
  },
  {
    id: 'forms-confirmation',
    label: 'フォーム回答の自動返信',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '回答後に送るメッセージは、一斉配信の停止に合わせて止まります。',
  },
  {
    id: 'nen-admin-sends',
    label: '会員管理からの案内送信',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '会員への案内は、一斉配信の停止に合わせて止まります。',
  },
  {
    id: 'mileage-adjustment-notice',
    label: 'マイル調整の完了通知',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: 'マイルを調整したときに送る通知です。一斉配信の停止中は送らず、送れなかった記録を残します。',
  },

  // ----------------------------------------------------------
  // シナリオ (scenario_dispatch)
  // ----------------------------------------------------------
  {
    id: 'scenario-cron',
    label: 'シナリオの順次配信',
    kind: 'auto',
    capability: 'scenario_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/step-delivery.ts', marker: "'scenario_dispatch'" },
    ],
    note: '停止中もシナリオへの登録は残ります。再開すると続きから配信します。',
  },
  {
    id: 'scenario-instant',
    label: 'シナリオ1通目の即時送信（友だち追加・タグ・クリック）',
    kind: 'auto',
    capability: 'scenario_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/immediate-first-step.ts', marker: "'scenario_dispatch'" },
    ],
    note: '停止中は送らず、シナリオへの登録だけ残ります。再開後に1通目を配信します。',
  },

  // ----------------------------------------------------------
  // リマインド・案内 (reminder_dispatch)
  {
    id: 'visit-stamp-expiry-reminders', label: '来店スタンプの期限のお知らせ', kind: 'scheduled', capability: 'reminder_dispatch',
    enforcement: [{ file: 'apps/worker/src/services/visit-stamp-reminders.ts', marker: "'reminder_dispatch'" }],
    note: '同じスタンプカードの同じ期限について、1回だけお知らせします。',
  },
  // ----------------------------------------------------------
  {
    id: 'reminder-cron',
    label: 'リマインダの予約配信',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/reminder-delivery.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は配信を始めません。送信前の通知は待機へ戻します。',
  },
  {
    id: 'booking-reminders',
    label: '予約リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/booking/booking-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は通知を待機させます。送信前に停止へ変わった通知も待機へ戻します。',
  },
  {
    id: 'event-booking-reminders',
    label: 'イベント予約リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/event-booking-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は通知を待機させます。',
  },
  {
    id: 'meet-consultation-reminders',
    label: 'Meet個別相談リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/meet-consultation-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は通知を待機させます。予約のお知らせの停止に合わせて止まります。',
  },
  {
    id: 'webinar-reminders',
    label: 'ウェビナー開始前リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/webinars/webinar-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は送らず、通知済みにもしません。再開後の定期確認で配信します。',
  },
  {
    id: 'webinar-notifications',
    label: 'ウェビナーの視聴・未視聴の案内',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/webinars/webinar-notifications.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は案内を待機させ、新しい配信を始めません。',
  },
  {
    id: 'webinar-followups',
    label: 'ウェビナー視聴後の案内',
    kind: 'auto',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/webinars/webinar-followups.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は視聴後の案内を登録せず、送信もしません。',
  },
  {
    id: 'waitlist-offers',
    label: 'キャンセル待ちの繰り上げ案内',
    kind: 'auto',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/event-waitlist.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は繰り上げの案内を待機させます。',
  },
  {
    id: 'booking-expirer-notice',
    label: '予約の期限切れ通知',
    kind: 'auto',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/booking/booking-expirer.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は受付待ちの予約を期限切れにせず、そのまま残します。',
  },

  // ----------------------------------------------------------
  // 自動化 (automation_actions)
  // ----------------------------------------------------------
  {
    id: 'automation-runs',
    label: '自動化した処理（送信・メニュー切り替え・外部連携）',
    kind: 'auto',
    capability: 'automation_actions',
    enforcement: [
      { file: 'apps/worker/src/features/automations/automation-engine.ts', marker: "'automation_actions'" },
    ],
    note: '停止中は処理を始めず、待機したまま残します。',
  },
  {
    id: 'legacy-automation',
    label: '以前に設定した自動処理',
    kind: 'auto',
    capability: 'automation_actions',
    enforcement: [
      { file: 'apps/worker/src/services/event-bus.ts', marker: "'automation_actions'" },
    ],
    note: '以前に設定したメッセージ送信・外部連携・メニュー切り替えも、まとめて止まります。',
  },
  {
    id: 'richmenu-targeting',
    label: 'リッチメニューの出し分け反映',
    kind: 'auto',
    capability: 'automation_actions',
    enforcement: [
      { file: 'apps/worker/src/services/event-bus.ts', marker: "'automation_actions'" },
    ],
    note: '条件に合わせてお客さまのメニューを変える処理も、自動化の停止に合わせて止まります。',
  },

  // ----------------------------------------------------------
  // 自動応答 (auto_reply_dispatch)
  // ----------------------------------------------------------
  {
    id: 'auto-reply',
    label: '自動応答（キーワード・一律応答）',
    kind: 'auto',
    capability: 'auto_reply_dispatch',
    enforcement: [
      { file: 'apps/worker/src/features/auto-replies/auto-reply.ts', marker: "'auto_reply_dispatch'" },
    ],
    note: '停止中に届いたメッセージには返信せず、送らなかった記録を残します。再開後のまとめ送りはしません。',
  },

  // ----------------------------------------------------------
  // 送信Webhook (webhook_outgoing)
  // ----------------------------------------------------------
  {
    id: 'outgoing-webhook-immediate',
    label: '外部サービスへの最初の通知',
    kind: 'external',
    capability: 'webhook_outgoing',
    enforcement: [
      { file: 'apps/worker/src/services/event-bus.ts', marker: "'webhook_outgoing'" },
    ],
    note: '停止中も送る予定は残します。外部への通知を止め、再開後に届けます。',
  },
  {
    id: 'outgoing-webhook-sweep',
    label: '外部サービスへ届かなかった通知の再送',
    kind: 'external',
    capability: 'webhook_outgoing',
    enforcement: [
      { file: 'apps/worker/src/services/outgoing-webhook-delivery.ts', marker: "'webhook_outgoing'" },
    ],
    note: '停止中は送らず、送信待ち・再送待ちのまま残します。',
  },
  {
    id: 'webhook-manual-retry',
    label: '送信Webhookの手動再送',
    kind: 'manual',
    capability: 'webhook_outgoing',
    enforcement: [
      { file: 'apps/worker/src/services/webhook-interactions.ts', marker: "'webhook_outgoing'" },
    ],
    note: '管理画面の再送操作も停止中は受け付けない。',
  },
  {
    id: 'webhook-test-send',
    label: '送信Webhookの試し送信',
    kind: 'manual',
    capability: 'webhook_outgoing',
    enforcement: [
      { file: 'apps/worker/src/routes/webhooks.ts', marker: "'webhook_outgoing'" },
    ],
    note: '停止中は試し送信もできません。画面に理由を表示します。',
  },

  // ----------------------------------------------------------
  // 広告ポストバック (ad_postback)
  // ----------------------------------------------------------
  {
    id: 'ad-conversion',
    label: '広告サービスへの成果の通知（Meta・X・Google・TikTok）',
    kind: 'external',
    capability: 'ad_postback',
    enforcement: [
      { file: 'apps/worker/src/services/ad-conversion.ts', marker: "'ad_postback'" },
    ],
    note: '停止中も通知する予定は残します。外部へ送らず、送信待ちに戻します。',
  },

  // ----------------------------------------------------------
  // 対象外（capability: null）
  // ----------------------------------------------------------
  {
    id: 'manual-chat-send',
    label: '受信箱の1対1返信（担当者の手動送信）',
    kind: 'manual',
    capability: null,
    excludedReason: '担当者が相手を見て送る個別返信は、一斉・自動配信の緊急停止の対象外です。',
    enforcement: [],
  },
  {
    id: 'manual-proxy-push',
    label: '外部ツールを使った担当者の個別返信',
    kind: 'manual',
    capability: null,
    excludedReason: '担当者が相手を確認して送る個別返信として指定されたメッセージは、緊急停止の対象外です。',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: "logSource !== 'manual'" },
    ],
  },
  {
    id: 'scheduled-chat-send',
    label: '受信箱の1対1送信予約',
    kind: 'scheduled',
    capability: null,
    excludedReason: '担当者が個別の相手に予約した1件送信です。手動返信と同じく一斉・自動配信の停止対象ではありません。',
    enforcement: [],
  },
  {
    id: 'booking-transactional',
    label: '予約確定・取消・受付の通知',
    kind: 'auto',
    capability: null,
    excludedReason: '顧客の操作（予約・取消・キャンセル待ち承諾）への応答で、状態変化そのものに紐づく通知は止めません。',
    enforcement: [],
  },
  {
    id: 'operator-notifications',
    label: '運用者への通知（LINE・メール・ダッシュボード）',
    kind: 'external',
    capability: null,
    excludedReason: '緊急停止そのものの通知を含む運用者向け連絡です。止めると異常と復旧の連絡手段を失います。',
    enforcement: [],
  },
];

/** capability 別に、停止対象に入る経路IDを返す（UI・テスト共用）。 */
export function sendPathsForCapability(capability: OperationCapability): OperationSendPath[] {
  return OPERATION_SEND_PATHS.filter((path) => path.capability === capability);
}

/** 台帳の健全性: capability は既知のものだけ、対象外には理由があること。 */
export function validateSendPathRegistry(): string[] {
  const problems: string[] = [];
  const known = new Set<string>(OPERATION_CAPABILITIES);
  const ids = new Set<string>();
  for (const path of OPERATION_SEND_PATHS) {
    if (ids.has(path.id)) problems.push(`duplicate id: ${path.id}`);
    ids.add(path.id);
    if (path.capability === null) {
      if (!path.excludedReason) problems.push(`${path.id}: excludedReason が必要です`);
    } else {
      if (!known.has(path.capability)) problems.push(`${path.id}: unknown capability ${path.capability}`);
      if (path.enforcement.length === 0) problems.push(`${path.id}: enforcement の証跡がありません`);
    }
    for (const ref of path.enforcement) {
      if (!ref.file || !ref.marker) problems.push(`${path.id}: enforcement の file/marker が空です`);
    }
  }
  return problems;
}
