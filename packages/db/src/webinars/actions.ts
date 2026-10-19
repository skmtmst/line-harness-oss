import { webinarActionReferenceValid } from '../webinar-action-references.js';
import { jstNow } from '../utils.js';
import { type WebinarAction, type WebinarActionInput, type WebinarActionExecutionInput, type WebinarActionExecutionStatus } from './types.js';


export async function getWebinarActions(db: D1Database, webinarId: string): Promise<WebinarAction[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM webinar_actions
       WHERE webinar_id = ? AND enabled = 1
       ORDER BY trigger, position`,
    )
    .bind(webinarId)
    .all<WebinarAction>();
  return results ?? [];
}

/**
 * 下書きのアクション一式を置き換える。実行履歴が参照する旧版は消さず、
 * 無効化して新版を追加する。
 */
export async function replaceWebinarActions(
  db: D1Database,
  webinarId: string,
  actions: WebinarActionInput[],
): Promise<WebinarAction[]> {
  const now = jstNow();
  // 有効な行をすべて外した後でも版番号を巻き戻さない。旧版との UNIQUE
  // 衝突を避けるだけでなく、実行履歴から設定変更の順序を追えるようにする。
  const latest = await db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM webinar_actions WHERE webinar_id = ?')
    .bind(webinarId)
    .first<{ version: number }>();
  const nextVersion = Number(latest?.version ?? 0) + 1;
  const statements = [
    db.prepare('UPDATE webinar_actions SET enabled = 0, updated_at = ? WHERE webinar_id = ? AND enabled = 1')
      .bind(now, webinarId),
    ...actions.map((action, position) => db.prepare(
      `INSERT INTO webinar_actions
         (id, webinar_id, trigger, action_type, config_json, position, version, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, action.trigger, action.actionType,
      JSON.stringify(action.config), position, nextVersion, now, now,
    )),
  ];
  await db.batch(statements);
  return getWebinarActions(db, webinarId);
}

/**
 * アクションが参照する設定（タグ・シナリオ・テンプレート・送信Webhook・
 * リッチメニューページ）が、対象ウェビナーのアカウント内で実在し
 * 使える状態かを調べる。参照を持たない種類（remove_rich_menu）は常に有効。
 *
 * 別アカウントの設定は「存在しない」と同じ扱いにして、呼び出し側が
 * 向こう側にそのIDがあるかを返り値から読み取れないようにする。
 * 検査と保存の間で参照が消えても安全側に止まれるよう、保存前だけでなく
 * 公開前の検証からも同じ関数を使う。返り値は参照先が無効だった
 * アクションの件数。0 ならすべて有効。
 */
export async function countInvalidWebinarActionReferences(
  db: D1Database,
  accountId: string | null,
  actions: ReadonlyArray<Pick<WebinarActionInput, 'actionType' | 'config'>>,
): Promise<number> {
  let invalid = 0;
  for (const action of actions) {
    if (!await webinarActionReferenceValid(db, accountId, action)) invalid += 1;
  }
  return invalid;
}

/**
 * 視聴後アクションの実行記録を冪等キーで1件だけ残す。
 * 既に同じキーの記録がある再送は何も書かず false を返す。
 */
export async function insertWebinarActionExecutionIgnore(
  db: D1Database,
  input: WebinarActionExecutionInput,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_action_executions
         (id, webinar_action_id, webinar_id, friend_id, session_start_at,
          trigger, status, attempt, idempotency_key, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.webinarActionId, input.webinarId, input.friendId,
      input.sessionStartAt, input.trigger, input.status, input.idempotencyKey,
      input.lastError ?? null, now, now,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 実行記録の結末を残す。冪等キーで1件だけ更新する。 */
export async function finishWebinarActionExecution(
  db: D1Database,
  idempotencyKey: string,
  status: WebinarActionExecutionStatus,
  lastError: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_action_executions
          SET status = ?, last_error = ?, updated_at = ?
        WHERE idempotency_key = ?`,
    )
    .bind(status, lastError, jstNow(), idempotencyKey)
    .run();
}
