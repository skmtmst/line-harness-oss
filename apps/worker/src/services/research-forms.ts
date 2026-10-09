import { getBroadcastMessageAsset, getFriendFieldByIdForScope, getSupportMarkById, getFormById, jstNow, publishFormVersion } from '@line-crm/db';
import { DEFAULT_TENANT_ID, layoutToFields, researchFormLayout, type FormAction, type ResearchGate } from '@line-crm/shared';
import { isScenarioActionComplete, runActionRows, type ScenarioActionRow } from './scenario-actions.js';
import { runAutoReplyAction, validateAutoReplyOperatorAction, type AutoReplyExecutionAction } from './auto-reply-operator-action.js';
import type { Env } from '../index.js';

async function researchBelongsToAccount(db: D1Database, ownerId: string | null, accountId: string | null): Promise<boolean> {
  if (!accountId) return false;
  if (ownerId !== null) return ownerId === accountId;
  const account = await db.prepare('SELECT tenant_id FROM line_accounts WHERE id=?').bind(accountId).first<{ tenant_id: string | null }>();
  return Boolean(account && (account.tenant_id ?? DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID);
}

/** 版とアカウントごとに固定する。新しい公開版でも入力中の質問と後処理を変えない。 */
export async function ensureResearchForm(db: D1Database, assetId: string, accountId: string): Promise<string> {
  const asset = await getBroadcastMessageAsset(db, assetId);
  if (!asset || asset.kind !== 'research' || asset.published_version < 1 || !await researchBelongsToAccount(db, asset.line_account_id, accountId)) throw new Error('RESEARCH_NOT_FOUND');
  const layout = researchFormLayout(asset.id, asset.published_version, asset.name, JSON.parse(asset.payload_json));
  for (const action of layout.options.afterActions ?? []) {
    if (action.kind === 'research_action' && action.actionType === 'event_booking') throw new Error('イベント予約操作は、日時の選び方を確認するまで実行できません');
    if (action.kind === 'research_action' && action.actionType !== 'notify_staff' && !isScenarioActionComplete(action.actionType, action.config)) throw new Error('回答後に行うことの設定を完成させてください');
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([asset.id, asset.published_version, accountId])));
  const key = Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2, '0')).join('');
  const id = `research-${key}`;
  const existing = await getFormById(db, id);
  if (existing?.current_published_version_id) return id;
  const now = jstNow();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO forms (id,name,description,fields,layout,save_to_metadata,is_active,created_at,updated_at)
      VALUES (?,?,?,?,?,0,0,?,?)`).bind(id, asset.name, JSON.parse(asset.payload_json).description || null, JSON.stringify(layoutToFields(layout)), JSON.stringify(layout), now, now),
    db.prepare('INSERT OR IGNORE INTO form_accounts (form_id,line_account_id) VALUES (?,?)').bind(id, accountId),
  ]);
  const result = await publishFormVersion(db, id, 1);
  if (result.kind !== 'published' && !(await getFormById(db, id))?.current_published_version_id) throw new Error('回答画面を準備できませんでした');
  return id;
}

export async function researchGateProblem(db: D1Database, gate: ResearchGate, friendId: string, now: Date): Promise<string | null> {
  const asset = await getBroadcastMessageAsset(db, gate.assetId);
  const friend = await db.prepare('SELECT line_account_id FROM friends WHERE id = ?').bind(friendId).first<{ line_account_id: string | null }>();
  if (!asset || asset.kind !== 'research' || asset.published_version < gate.version || !friend || !await researchBelongsToAccount(db, asset.line_account_id, friend.line_account_id)) return 'いま回答を受け付けていません';
  if (gate.startsAt && now.getTime() < Date.parse(gate.startsAt)) return 'まだ回答の受付が始まっていません';
  if (gate.endsAt && now.getTime() >= Date.parse(gate.endsAt)) return '回答の受付が終了しました';
  if (gate.targetTagId) {
    const tagged = await db.prepare('SELECT 1 FROM friend_tags WHERE friend_id=? AND tag_id=?').bind(friendId, gate.targetTagId).first();
    if (!tagged) return 'このリサーチの回答対象ではありません';
  }
  return null;
}

/** フォームの工程記録が再送を守り、各動作は既存のアカウント境界を使う。 */
export async function runResearchAnswerAction(db: D1Database, action: Extract<FormAction, { kind: 'research_action' }>, friendId: string, effectKey: string, env?: Env['Bindings']): Promise<void> {
  const friend = await db.prepare('SELECT line_account_id FROM friends WHERE id = ?').bind(friendId).first<{ line_account_id: string | null }>();
  if (!friend?.line_account_id) throw new Error('回答者のアカウントを確認できませんでした');
  await validateResearchActionScope(db, action, friend.line_account_id);
  const row: AutoReplyExecutionAction = {
    id: effectKey, scenario_id: '', hook: 'choice_selected', step_id: null, choice_index: null,
    sort_order: 0, action_type: action.actionType, config_json: JSON.stringify(action.config), condition_json: null, repeat_on_refire: 1,
  };
  if (action.actionType === 'notify_staff') {
    const problem = await validateAutoReplyOperatorAction(db, row, friend.line_account_id, true);
    if (problem) throw new Error(problem);
  } else if (!isScenarioActionComplete(action.actionType, action.config)) throw new Error('回答後に行うことの設定が不完全です');
  const result = action.actionType === 'notify_staff'
    ? await runAutoReplyAction(db, row, friendId, { lineAccountId: friend.line_account_id, sourceEventId: effectKey, env })
    : await runActionRows(db, [row as ScenarioActionRow], friendId, { accountId: friend.line_account_id });
  if (result.failed || result.skippedIncomplete) throw new Error('回答後に行うことを完了できませんでした');
}

/** 他店のIDは、実行関数が黙って飛ばす前に失敗として知らせる。 */
export async function validateResearchActionScope(db: D1Database, action: Extract<FormAction, { kind: 'research_action' }>, accountId: string): Promise<void> {
  const requireResource = async (table: string, id: unknown, published = false) => {
    if (typeof id !== 'string' || !id) throw new Error('回答後に行うことの対象を選んでください');
    const accountColumn = table === 'folders' ? 'account_id' : 'line_account_id';
    const row = await db.prepare(`SELECT ${accountColumn} AS line_account_id${published ? ',published_version' : ''} FROM ${table} WHERE id=?${table === 'folders' ? " AND kind='tag'" : ''}`).bind(id).first<{ line_account_id: string | null; published_version?: number }>();
    if (!row || !await researchBelongsToAccount(db, row.line_account_id, accountId) || (published && !row.published_version)) throw new Error('このアカウントで使える公開済みの対象を選んでください');
  };
  const c = action.config;
  switch (action.actionType) {
    case 'tag':
      if (Array.isArray(c.tagIds)) for (const id of c.tagIds) await requireResource('tags', id);
      if (c.folderId) await requireResource('folders', c.folderId);
      break;
    case 'friend_field': case 'support_mark': {
      if (action.actionType === 'support_mark' && c.markId === null) break;
      const account = await db.prepare('SELECT tenant_id FROM line_accounts WHERE id=?').bind(accountId).first<{ tenant_id: string | null }>();
      if (!account) throw new Error('アカウントを確認できませんでした');
      const scope = { tenantId: account.tenant_id ?? DEFAULT_TENANT_ID, lineAccountId: accountId };
      const resource = action.actionType === 'friend_field' ? await getFriendFieldByIdForScope(db, String(c.fieldId), scope) : await getSupportMarkById(db, String(c.markId), scope);
      if (!resource) throw new Error('このアカウントで使える情報欄・対応マークを選んでください');
      break;
    }
    case 'scenario': if (c.scenarioId) await requireResource('scenarios', c.scenarioId); break;
    case 'send_template': await requireResource('templates', c.templateId, true); break;
    case 'reminder': await requireResource('reminders', c.reminderId); break;
    case 'event_booking': throw new Error('イベント予約操作は、日時の選び方を確認するまで実行できません');
  }
}
