/**
 * エラー文面の対応表。設計 ★V6 34（要件 v6-34 §9）。台帳 #134。
 *
 * **route の error 原文を画面へ出さない。** 画面はコードで表を引き、
 * 見つからなければ汎用文面と追跡番号に落とす。
 * 鍵はエラーコード。code が無い現行 route は error 文字列そのものを鍵にする。
 *
 * 初期データの正本は migration 463 の INSERT（実 DB はそこから入る）。
 * bootstrap 生成物はスキーマだけを持つため、テスト・新規の作り立てDBでは
 * 表が空のままになる——その場合だけ `ensureErrorMessages` が同じ行を蒔く。
 * 両者の整合は `463_error_messages_org_recipes.test.ts` の一致試験が守る。
 */

export type ErrorMessageNextActionKind = 'navigate' | 'retry' | 'contact_admin' | 'none';

export interface ErrorMessageRow {
  code: string;
  message: string;
  next_action_kind: ErrorMessageNextActionKind;
  next_action_target: string | null;
  source: string;
  version: number;
}

export interface ErrorMessageSeed {
  code: string;
  message: string;
  nextActionKind: ErrorMessageNextActionKind;
  nextActionTarget?: string;
  source: string;
}

/**
 * 要件 §9-2 の対応表（初版）。実在するコードと文字列だけを登録する。
 * 増やすときは migration 側の INSERT と必ずそろえる。
 */
export const ERROR_MESSAGE_SEED: ErrorMessageSeed[] = [
  { code: 'Unauthorized', message: 'ログインの有効期限が切れました',
    nextActionKind: 'navigate', nextActionTarget: '/login', source: 'middleware/auth.ts' },
  { code: 'CSRF token mismatch', message: '画面が古くなっています。再読み込みしてから、もう一度お試しください',
    nextActionKind: 'retry', source: 'middleware/auth.ts' },
  { code: '閲覧のみの権限では変更操作を実行できません', message: 'この操作には変更権限が必要です',
    nextActionKind: 'contact_admin', source: 'middleware/auth.ts' },
  { code: 'この機能を操作する権限がありません', message: 'この機能の権限がありません',
    nextActionKind: 'contact_admin', source: 'middleware/auth.ts' },
  { code: 'この操作には権限が必要です', message: 'この操作は決められた役割の人だけが行えます',
    nextActionKind: 'contact_admin', source: 'middleware/role-guard.ts' },
  { code: 'CONFIRMATION_REQUIRED', message: '取り消せない操作です。確認画面を経てください',
    nextActionKind: 'none', source: 'middleware/role-guard.ts' },
  { code: 'FEATURE_DISABLED', message: 'この機能は機能設定でオフになっています',
    nextActionKind: 'navigate', nextActionTarget: '/settings/features', source: 'feature gates' },
  { code: 'REVISION_CONFLICT', message: '別の人が先に変更しました。最新の状態を読み込んでから、もう一度お試しください',
    nextActionKind: 'retry', source: '各 route / 共通基盤 §10' },
  { code: 'VERSION_CONFLICT', message: '別の人が先に変更しました。最新の状態を読み込んでから、もう一度お試しください',
    nextActionKind: 'retry', source: '各 route / 共通基盤 §10' },
  { code: 'IN_USE', message: '使われているため削除できません',
    nextActionKind: 'none', source: 'friend-attributes.ts ほか' },
  { code: 'TAG_IN_USE', message: '使われているため削除できません',
    nextActionKind: 'none', source: 'friend-attributes.ts ほか' },
  { code: 'REFERENCED', message: 'ほかの設定から参照されているため削除できません',
    nextActionKind: 'none', source: 'friend-attributes.ts ほか' },
  { code: 'INHERITED_MARK_IN_USE', message: '使われているため削除できません',
    nextActionKind: 'none', source: 'friend-attributes.ts ほか' },
  { code: 'LINE account not found', message: 'LINEアカウントが選ばれていません',
    nextActionKind: 'none', source: 'line-accounts.ts ほか' },
  { code: 'missing_account_id', message: 'LINEアカウントが選ばれていません',
    nextActionKind: 'none', source: 'line-accounts.ts ほか' },
  { code: 'accountId is required', message: 'LINEアカウントが選ばれていません',
    nextActionKind: 'none', source: 'line-accounts.ts ほか' },
  { code: 'LINEアカウントを特定できません', message: 'どのLINEアカウントの操作か決められません。画面上部でアカウントを選び直してください',
    nextActionKind: 'none', source: 'liff.ts' },
  { code: 'Invalid signature', message: '受信した通知の署名が一致しません。接続の秘密値を確認してください',
    nextActionKind: 'navigate', nextActionTarget: '/settings/integrations', source: 'webhooks.ts / ec-integrations.ts' },
  { code: 'Invalid LINE signature', message: 'LINEからの受信を検証できませんでした。チャネルシークレットが違う可能性があります',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'routes/webhook.ts' },
  { code: 'WEBHOOK_PAYLOAD_UNAVAILABLE', message: 'この受信は本文を保存していないため再処理できません。新しい受信を待ってください',
    nextActionKind: 'none', source: 'line-webhook-events.ts' },
  { code: 'LINE API error: 401', message: 'LINEのアクセストークンが無効です。資格情報を差し替えてください',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'packages/line-sdk' },
  { code: 'LINE API error: 403', message: 'LINEがこのアカウントの操作を拒否しています',
    nextActionKind: 'navigate', nextActionTarget: '/emergency', source: 'services/ban-monitor.ts' },
  { code: 'LINE API error: 429', message: 'LINEの利用制限にかかりました。しばらくして自動で再試行します',
    nextActionKind: 'retry', source: 'packages/line-sdk' },
  { code: 'LINE API error: 400', message: 'LINEが本文を受け付けませんでした。本文の内容を確認してください',
    nextActionKind: 'none', source: 'packages/line-sdk' },
  { code: 'quota_limited', message: '今月の送信枠を使い切りました。配信予定を見直してください',
    nextActionKind: 'navigate', nextActionTarget: '/broadcasts', source: 'routes/dashboard.ts' },
  { code: 'quota_unavailable', message: '送信枠をいま確かめられません。少し待ってから再確認してください',
    nextActionKind: 'retry', source: 'routes/dashboard.ts' },
  { code: 'rate_limit', message: '短い時間に操作が集中しました。少し待ってから、もう一度お試しください',
    nextActionKind: 'retry', source: 'middleware/rate-limit.ts' },
  { code: 'Idempotency-Key was already used with a different request', message: '同じ操作番号で違う内容が送られました。画面を再読み込みして送り直してください',
    nextActionKind: 'retry', source: 'broadcasts.ts' },
  { code: 'Broadcast is already sent or sending', message: 'この配信はすでに送信中または送信済みです',
    nextActionKind: 'navigate', nextActionTarget: '/broadcasts', source: 'broadcasts.ts' },
  { code: 'No test recipients configured', message: 'テスト受信者が登録されていません',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'broadcasts.ts' },
  { code: 'TEMPLATE_TEXT_TOO_LONG', message: '本文が長すぎます。短くしてから、もう一度お試しください',
    nextActionKind: 'none', source: 'templates.ts' },
  { code: 'Payload too large', message: '送信できる大きさを超えています。添付を減らしてください',
    nextActionKind: 'none', source: '各 route / webhook.ts' },
  { code: 'too_large', message: '送信できる大きさを超えています。添付を減らしてください',
    nextActionKind: 'none', source: '各 route / webhook.ts' },
  { code: 'Internal Server Error', message: '処理できませんでした（追跡番号 {incidentId}）',
    nextActionKind: 'retry', source: 'index.ts' },
  { code: 'SQLITE_BUSY_SNAPSHOT', message: '保存先が一時的に混み合っています。少し待ってから、もう一度お試しください',
    nextActionKind: 'retry', source: 'D1 / broadcasts.ts' },
  { code: 'SQLITE_ERROR', message: '保存先が一時的に混み合っています。少し待ってから、もう一度お試しください',
    nextActionKind: 'retry', source: 'D1 / broadcasts.ts' },
  { code: 'D1_ERROR', message: '保存先が一時的に混み合っています。少し待ってから、もう一度お試しください',
    nextActionKind: 'retry', source: 'D1 / broadcasts.ts' },
  { code: 'CredentialEncryptionKeyError', message: '資格情報の暗号化鍵が設定されていません。運営へ連絡してください',
    nextActionKind: 'contact_admin', source: 'packages/db/src/credential-crypto.ts' },
  { code: 'Unable to decrypt LINE credential; no legacy fallback is available', message: '資格情報を復号できません。資格情報を差し替えてください',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'packages/db/src/line-accounts.ts' },
  { code: '認証コードが正しくありません', message: '認証コードが違います。入力し直してください',
    nextActionKind: 'retry', source: 'admin-auth.ts' },
  { code: '入力回数を超えました。LINEログインからやり直してください', message: '認証の試行回数を超えました。LINEログインからやり直してください',
    nextActionKind: 'navigate', nextActionTarget: '/login', source: 'admin-auth.ts' },
  { code: 'この認証コードは使用済みです', message: '使用済みの認証コードです。次のコードを待ってください',
    nextActionKind: 'none', source: 'admin-auth.ts' },
  { code: '認証の有効時間が切れました', message: '認証の有効時間が切れました。LINEログインからやり直してください',
    nextActionKind: 'navigate', nextActionTarget: '/login', source: 'admin-auth.ts' },
  { code: 'Invalid ID token', message: 'LIFFの認証に失敗しました。LIFFの設定を確認してください',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'liff.ts' },
  { code: 'unknown_liff', message: 'LIFFの認証に失敗しました。LIFFの設定を確認してください',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'liff.ts' },
  { code: 'LINE Login is not configured', message: 'LINE Loginが未設定です。Loginチャネルを登録してください',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'admin-auth.ts' },
  { code: 'Messaging API の Channel Access Token を確認してください', message: 'アクセストークンが無効です。入力し直してください',
    nextActionKind: 'retry', source: 'line-accounts.ts verifyConnection' },
  { code: 'Webhook URL の一致・利用設定・接続テストを確認してください', message: 'LINE Developers の Webhook 設定が一致しません',
    nextActionKind: 'navigate', nextActionTarget: '/accounts', source: 'line-accounts.ts verifyConnection' },
  { code: 'LIFF ID の形式を確認してください', message: 'LIFF ID の形式が違います（例: 1234567890-abcdEFGH）',
    nextActionKind: 'retry', source: 'line-accounts.ts verifyConnection' },
];

/**
 * 空の表に初期行を蒔く（冪等）。実 DB では migration 463 が先に入れて
 * いるので通常は何もしない。bootstrap だけで作った試験・新規 DB 用。
 */
export async function ensureErrorMessages(db: D1Database): Promise<void> {
  // 入っているなら何もしない。読むたびに蒔き直さない。
  const existing = await db
    .prepare(`SELECT 1 AS hit FROM error_messages LIMIT 1`)
    .first<{ hit: number }>();
  if (existing) return;
  await db.batch(
    ERROR_MESSAGE_SEED.map((row) =>
      db.prepare(
        `INSERT OR IGNORE INTO error_messages
           (code, message, next_action_kind, next_action_target, source)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(row.code, row.message, row.nextActionKind, row.nextActionTarget ?? null, row.source),
    ),
  );
}

export async function listErrorMessages(db: D1Database): Promise<ErrorMessageRow[]> {
  await ensureErrorMessages(db);
  const result = await db
    .prepare(`SELECT code, message, next_action_kind, next_action_target, source, version
                FROM error_messages ORDER BY code`)
    .all<ErrorMessageRow>();
  return result.results;
}
