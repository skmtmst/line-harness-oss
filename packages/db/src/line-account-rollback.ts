import { jstNow } from './utils.js';

/**
 * 作成途中のロールバック専用。永続化済みアカウントは archiveLineAccount を使う。
 * 接続フローはアカウント作成後に capability 判定などを子表へ書くため、
 * 親行だけでなく子行も同じ batch で消す。D1 は外部キーをあてにできない。
 *
 * 親行 DELETE は D1 で落ちることがある（HTTP 400 / code 7500
 * `triggers nested too deep`）。line_accounts を ON DELETE CASCADE で参照する表が
 * 116 経路あるため、文を組み立てる時点で 18,719 命令・下位プログラム 384 本になり、
 * D1 の式の深さの上限を超える。行数には依存しない（0件でも1件でも同じ命令数）ので
 * 子行を先に消しても通らず、D1 では外部キーを切ることもできない。
 * 通らなかったときは行を無効化し、一意列（channel_id / login_channel_id / liff_id）を
 * 解放する。これをしないと、追加に失敗した同じチャネルを再登録できなくなる。
 * 詳細は docs/integrations/line-connection.md。
 */
export async function deleteUncommittedLineAccount(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM account_settings WHERE line_account_id = ?`).bind(id),
    db.prepare(`DELETE FROM line_account_tag_links WHERE line_account_id = ?`).bind(id),
    db.prepare(`DELETE FROM line_account_connection_checks WHERE line_account_id = ?`).bind(id),
  ]);
  try {
    await db.prepare(`DELETE FROM line_accounts WHERE id = ?`).bind(id).run();
    return;
  } catch (error) {
    // 親行削除に失敗した場合は無効化して一意列を解放。
    // D1では外部キー制約の深さの上限でこの例外が発生するため、
    // エラー詳細をログに記録せず silent に fallback する。
    await releaseUncommittedLineAccount(db, id);
  }
}

/**
 * 親行を消せなかったときの後始末。行は残るが、
 * 秘密値を空にし、停止・アーカイブ状態にして、一意列を解放する。
 * channel_id は NOT NULL なので、衝突しない値（`abandoned:<id>`）へ退避する。
 * login_channel_id / liff_id の一意索引は NULL を重複とみなさないため NULL に戻す。
 */
async function releaseUncommittedLineAccount(db: D1Database, id: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE line_accounts
          SET channel_id = ?, login_channel_id = NULL, liff_id = NULL,
              channel_access_token = '', channel_secret = '',
              channel_access_token_encrypted = NULL, channel_secret_encrypted = NULL,
              login_channel_secret = NULL, login_channel_secret_encrypted = NULL,
              is_active = 0, is_default = 0,
              archived_at = COALESCE(archived_at, ?), archived_by = 'system',
              archived_reason = '追加に失敗した未確定アカウント（削除できないため無効化）',
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(`abandoned:${id}`, now, now, id)
    .run();
}
