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
  // ----------------------------------------------------------
  // 一斉配信 (broadcast_dispatch)
  // ----------------------------------------------------------
  {
    id: 'broadcast-send',
    label: '一斉配信（予約・今すぐ送信・分割送信）',
    kind: 'scheduled',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/broadcast.ts', marker: "isOperationCapabilityStopped(db, ownerAccountId, 'broadcast_dispatch')" },
      { file: 'apps/worker/src/services/dedup-broadcast.ts', marker: "'broadcast_dispatch'" },
      { file: 'apps/worker/src/routes/broadcasts.ts', marker: "'broadcast_dispatch'" },
    ],
    note: '束と束のあいだで止まる。停止中に時刻を過ぎた予約は復旧時に下書きへ戻し、まとめて追い送りしない。',
  },
  {
    id: 'nen-deliveries',
    label: 'NENキャンペーン配信',
    kind: 'scheduled',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/nen-engagement.ts', marker: "'broadcast_dispatch'" },
    ],
    note: 'キャンペーンの一斉案内は一斉配信と同じ停止対象。停止中は pending のまま残る。',
  },
  {
    id: 'line-proxy-automated',
    label: 'プロキシ経由の自動 push・multicast・broadcast',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '外部エージェント等からの直下り送信の最後の砦。経路ヘッダが無い自動送信は一斉配信として止める。',
  },
  {
    id: 'forms-confirmation',
    label: 'フォーム回答の自動返信',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '送信はプロキシ経由。経路ヘッダを付けない自動送信は一斉配信の停止に連動して止まる。',
  },
  {
    id: 'nen-admin-sends',
    label: 'NEN管理画面からの案内送信',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: 'nen-members / nen-campaigns / nen-engagement の push はすべてプロキシ経由。経路ヘッダを付けないため一斉配信の停止に連動して止まる。',
  },
  {
    id: 'mileage-adjustment-notice',
    label: 'マイル調整の完了通知',
    kind: 'proxy',
    capability: 'broadcast_dispatch',
    enforcement: [
      { file: 'apps/worker/src/routes/line-proxy.ts', marker: 'isOperationCapabilityStopped' },
    ],
    note: '運用者の調整操作に連動する1件通知。プロキシ経由で経路ヘッダを付けないため、一斉配信の停止中は送らず failed として監査に残る。',
  },

  // ----------------------------------------------------------
  // シナリオ (scenario_dispatch)
  // ----------------------------------------------------------
  {
    id: 'scenario-cron',
    label: 'シナリオ配信（cron）',
    kind: 'auto',
    capability: 'scenario_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/step-delivery.ts', marker: "'scenario_dispatch'" },
    ],
    note: '停止中は登録行を active のまま残し、claim しない。復旧で続きから届く。',
  },
  {
    id: 'scenario-instant',
    label: 'シナリオ1通目の即時送信（友だち追加・タグ・クリック）',
    kind: 'auto',
    capability: 'scenario_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/immediate-first-step.ts', marker: "'scenario_dispatch'" },
    ],
    note: '停止中は送らず登録行だけ残る。cron 側も同じ停止を見るので、復旧後に cron が1通目を届ける。',
  },

  // ----------------------------------------------------------
  // リマインド・案内 (reminder_dispatch)
  // ----------------------------------------------------------
  {
    id: 'reminder-cron',
    label: 'リマインダ配信（cron）',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/reminder-delivery.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は実行行を claim しない。claim 済みの行は queued へ戻す。',
  },
  {
    id: 'booking-reminders',
    label: '予約リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/booking-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は pending のまま残る。claim 後に停止へ切り替わった分は claim を戻す。',
  },
  {
    id: 'event-booking-reminders',
    label: 'イベント予約リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/event-booking-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は pending のまま残る。',
  },
  {
    id: 'meet-consultation-reminders',
    label: 'Meet個別相談リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/meet-consultation-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は pending のまま残る。送信はプロキシ経由で reminder_dispatch を名乗る。',
  },
  {
    id: 'webinar-reminders',
    label: 'ウェビナー開始前リマインド',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/webinar-reminders.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は送らず通知済みにしない。復旧後に次の tick が拾う。',
  },
  {
    id: 'webinar-notifications',
    label: 'ウェビナー通知（視聴・未視聴の案内ジョブ）',
    kind: 'scheduled',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/webinar-notifications.ts', marker: "'reminder_dispatch'" },
    ],
    note: '#745 で導入済み。停止中は queued のまま残し、claim も増やさない。',
  },
  {
    id: 'webinar-followups',
    label: 'ウェビナー追跡配信・ジャーニー案内',
    kind: 'auto',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/webinar-followups.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は追跡行を作らず送らない。',
  },
  {
    id: 'waitlist-offers',
    label: 'キャンセル待ちの繰り上げ案内',
    kind: 'auto',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/event-waitlist.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は job を pending のまま残す。',
  },
  {
    id: 'booking-expirer-notice',
    label: '予約の期限切れ通知',
    kind: 'auto',
    capability: 'reminder_dispatch',
    enforcement: [
      { file: 'apps/worker/src/services/booking-expirer.ts', marker: "'reminder_dispatch'" },
    ],
    note: '停止中は予約を期限切れにしない（requested のまま保持）。機能オフと同じ扱い。',
  },

  // ----------------------------------------------------------
  // 自動化 (automation_actions)
  // ----------------------------------------------------------
  {
    id: 'automation-runs',
    label: '自動化の実行（送信・メニュー切替・Webhook起動を含む全アクション）',
    kind: 'auto',
    capability: 'automation_actions',
    enforcement: [
      { file: 'apps/worker/src/services/automation-engine.ts', marker: "'automation_actions'" },
    ],
    note: '実行本体 (processAutomationRun) の入口で止める。停止中は queued のまま残る。',
  },
  {
    id: 'legacy-automation',
    label: 'イベント連動の旧自動化アクション',
    kind: 'auto',
    capability: 'automation_actions',
    enforcement: [
      { file: 'apps/worker/src/services/event-bus.ts', marker: "'automation_actions'" },
    ],
    note: '旧式ルールのアクション群（send_message / send_webhook / メニュー切替）をまとめて止める。',
  },
  {
    id: 'richmenu-targeting',
    label: 'リッチメニューの出し分け反映',
    kind: 'auto',
    capability: 'automation_actions',
    enforcement: [
      { file: 'apps/worker/src/services/event-bus.ts', marker: "'automation_actions'" },
    ],
    note: 'メッセージ送信ではないが、イベントに連動して顧客側の表示を変える LINE 呼び出しのため同じ停止に連動。',
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
      { file: 'apps/worker/src/services/auto-reply.ts', marker: "'auto_reply_dispatch'" },
    ],
    note: 'replyToken は持ち越せないため、停止中に受けた分は「停止のため未送信」として台帳へ残し、追い送りしない。',
  },

  // ----------------------------------------------------------
  // 送信Webhook (webhook_outgoing)
  // ----------------------------------------------------------
  {
    id: 'outgoing-webhook-immediate',
    label: 'イベント発火時の送信Webhook初回配送',
    kind: 'external',
    capability: 'webhook_outgoing',
    enforcement: [
      { file: 'apps/worker/src/services/event-bus.ts', marker: "'webhook_outgoing'" },
    ],
    note: '停止中も台帳 (outgoing_webhook_deliveries) には積む。初回の外部送信だけ止め、復旧後に sweep が届ける。',
  },
  {
    id: 'outgoing-webhook-sweep',
    label: '送信Webhookの再送スイープ',
    kind: 'external',
    capability: 'webhook_outgoing',
    enforcement: [
      { file: 'apps/worker/src/services/outgoing-webhook-delivery.ts', marker: "'webhook_outgoing'" },
    ],
    note: '停止中は claim せず pending / retry_wait のまま残す。',
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
    note: '管理画面の試し送信も停止中は 409 を返す。',
  },

  // ----------------------------------------------------------
  // 広告ポストバック (ad_postback)
  // ----------------------------------------------------------
  {
    id: 'ad-conversion',
    label: '広告コンバージョン送信（Meta / X / Google / TikTok）',
    kind: 'external',
    capability: 'ad_postback',
    enforcement: [
      { file: 'apps/worker/src/services/ad-conversion.ts', marker: "'ad_postback'" },
    ],
    note: '停止中も outbox へは積む。外部への送信試行だけ止め、pending へ戻す。',
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
    label: 'プロキシ経由の担当者個別返信（manual 指定）',
    kind: 'manual',
    capability: null,
    excludedReason: 'X-Line-Harness-Source: manual を付けた1対1 push は手動返信と同じく対象外です。',
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
