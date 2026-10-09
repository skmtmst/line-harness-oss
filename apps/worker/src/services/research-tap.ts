import { getBroadcastMessageAsset, jstNow } from '@line-crm/db';
import { applyTapExtras } from './tap-extras.js';
import { couponDate, type TapExtras } from '@line-crm/shared';
import { acquireWorkflow } from './workflow-execution.js';

/** 既存の回答ログと継続処理を使う。追加処理のための表は作らない。 */
export async function handleResearchTap(db: D1Database, friendId: string, accountId: string | null, data: string): Promise<string> {
  const match = /^research:([A-Za-z0-9_-]+):(\d+):(\d+):(\d+)$/.exec(data);
  if (!match) return 'この選択肢は使えません';
  const asset = await getBroadcastMessageAsset(db, match[1]);
  if (!asset || asset.kind !== 'research' || !asset.published_version || asset.line_account_id !== accountId) return 'このリサーチは使えません';
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version) || version < 1 || version > asset.published_version) return 'このリサーチは使えません';
  const snapshot = version === asset.published_version ? asset.payload_json : (await db.prepare('SELECT payload_json FROM broadcast_asset_versions WHERE asset_id=? AND version_number=?').bind(asset.id,version).first<{payload_json:string}>())?.payload_json;
  if (!snapshot) return 'このリサーチは使えません';
  const payload = JSON.parse(snapshot);
  const question = payload.questions?.[Number(match[3])];
  const label = question?.choices?.[Number(match[4])];
  if (!question || typeof label !== 'string') return 'この選択肢は使えません';
  const now = Date.now();
  const date = couponDate;
  if (payload.startsAt && now < date(payload.startsAt)) return 'まだ回答の受付期間ではありません';
  if (payload.endsAt && now >= date(payload.endsAt)) return '回答の受付期間が終わっています';
  const subjectId = JSON.stringify([asset.id, version, friendId, match[3], question.format === 'multiple' ? match[4] : 'single']);
  const execution = await acquireWorkflow(db, { scopeId: `line:${accountId ?? 'default'}`, processKind: 'research_tap', subjectId }, { input: { label, extras: question.choiceTapExtras?.[Number(match[4])] ?? {} }, maxAttempts: 5 });
  if (!execution) return 'この質問には回答済みです';
  try {
    // 初回の選択と追加処理は継続処理の入力に固定する。
    const { getWorkflowStep } = await import('@line-crm/db');
    const saved = JSON.parse((await getWorkflowStep(db, execution.ref))!.input_json!) as { label: string; extras: TapExtras };
    await execution.step('extras', () => applyTapExtras(execution.mutationDb('extras'), friendId, accountId, saved.extras, subjectId));
    await execution.step('log', () => execution.mutationDb('log').prepare(`INSERT OR IGNORE INTO messages_log (id,friend_id,direction,message_type,content,source,line_account_id,created_at) VALUES (?,?,'incoming','text',?,'research',?,?)`).bind(subjectId,friendId,saved.label,accountId,jstNow()).run());
    await execution.complete();
    return '回答を受け付けました';
  } catch (error) { await execution.fail(); throw error; }
}
