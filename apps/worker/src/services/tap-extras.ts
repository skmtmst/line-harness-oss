import { addScore, getOrCreateAutoTrackedLink, getTrackedLinkByIdOrShortCode, validateScenarioActionReferences } from '@line-crm/db';
import { collectTapExtraTagIds, hasTapExtras, tapExtrasError, validateTapExtrasTree, type TapExtras } from '@line-crm/shared';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';

const PREFIX = 'tapextra1:';
/** 保存済み計測リンクの再利用キーに、変更されない追加処理の写しを持つ。 */
export function extrasFromTrackedLink(link: { dedup_key: string | null }): TapExtras | undefined {
  const part = link.dedup_key?.split('|')[1];
  if (!part?.startsWith(PREFIX)) return undefined;
  try {
    const value = JSON.parse(decodeURIComponent(part.slice(PREFIX.length)));
    if (tapExtrasError(value.extras)) return undefined;
    return value.extras;
  } catch { return undefined; }
}
export async function validateTapExtraReferences(db: D1Database, value: unknown, accountId: string | null): Promise<string | null> {
  const error = validateTapExtrasTree(value);
  if (error) return error;
  const ids = collectTapExtraTagIds(value);
  if (ids.length && !(await validateScenarioActionReferences(db, accountId, 'tag', { op: 'add', tagIds: ids })).ok) return '付けるタグを選び直してください';
  return null;
}
export async function applyTapExtras(db: D1Database, friendId: string, accountId: string | null, extras: TapExtras, eventId: string): Promise<void> {
  if (tapExtrasError(extras)) throw new Error('invalid_tap_extras');
  const friend = await db.prepare('SELECT line_account_id FROM friends WHERE id=?').bind(friendId).first<{ line_account_id: string | null }>();
  if (!friend || friend.line_account_id !== accountId) throw new Error('tap_extra_account_mismatch');
  const ids = [...new Set(extras.tagIds ?? [])];
  if (ids.length && !(await validateScenarioActionReferences(db, accountId, 'tag', { op: 'add', tagIds: ids })).ok) throw new Error('tap_extra_tag_unavailable');
  for (const id of ids) {
    await attachTagAndFireSideEffects(db, friendId, id);
  }
  if (extras.scoreChange) await addScore(db, { friendId, scoreChange: extras.scoreChange, reason: 'ボタンを押したときの加点', idempotencyKey: JSON.stringify(['tapextra', eventId, friendId]) });
}
/** イメージマップはpostbackを持てないため、計測後に自店のLINE入力欄を開く。
 * https://developers.line.biz/ja/docs/messaging-api/using-line-url-scheme/
 */
async function imagemapTextDestination(db: D1Database, accountId: string | null, text: unknown): Promise<string> {
  const account = accountId ? await db.prepare('SELECT line_basic_id FROM line_accounts WHERE id=? AND is_active=1 AND archived_at IS NULL')
    .bind(accountId).first<{ line_basic_id: string | null }>() : null;
  if (!account?.line_basic_id || !/^@[A-Za-z0-9._-]+$/.test(account.line_basic_id)) {
    throw new Error('テキストの入力欄を開くため、送信先のLINEアカウントのLINE IDを確認してください');
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 400) throw new Error('送る文章は1〜400文字で入力してください');
  return `https://line.me/R/oaMessage/${encodeURIComponent(account.line_basic_id)}/?${encodeURIComponent(text)}`;
}
/** LINEへは独自項目を渡さず、URLとイメージマップのテキストは既存の転送、ほかのテキストはpostbackにする。 */
export async function decorateTapExtras(db: D1Database, tree: unknown, workerUrl: string, accountId: string | null, templateId?: string | null, broadcastId?: string | null): Promise<unknown> {
  if (Array.isArray(tree)) return Promise.all(tree.map(child => decorateTapExtras(db, child, workerUrl, accountId, templateId, broadcastId)));
  if (!tree || typeof tree !== 'object') return tree;
  const node = tree as Record<string, unknown>;
  const { tapExtras, ...rest } = node;
  const extras = tapExtras as TapExtras | undefined;
  if (tapExtrasError(tapExtras)) throw new Error('invalid_tap_extras');
  if (hasTapExtras(extras)) {
    const error = await validateTapExtraReferences(db, { tapExtras: extras }, accountId);
    if (error) throw new Error('tap_extra_tag_unavailable');
    // 回数制限のあるクーポン・質問は、それぞれの受け取り側で実行する。
    const originalData = typeof node.data === 'string' ? node.data : '';
    if (node.type === 'postback' && (/^coupon_use:/.test(originalData) || /^sq:/.test(originalData))) return rest;
    if (node.type !== 'uri' && node.type !== 'postback' && node.type !== 'message') throw new Error('tap_extra_action_unsupported');
    const imagemapMessage = node.type === 'message' && Boolean(node.area);
    const destination = imagemapMessage ? await imagemapTextDestination(db, accountId, node.text)
      : node.type === 'uri' ? String(node.uri ?? node.linkUri ?? '') : `${workerUrl.replace(/\/$/, '')}/`;
    if (!/^https?:\/\//.test(destination)) throw new Error('tap_extra_url_unsupported');
    const scope = PREFIX + encodeURIComponent(JSON.stringify({ extras: { tagIds: [...new Set(extras?.tagIds ?? [])].sort(), scoreChange: extras?.scoreChange ?? null }, broadcastId: broadcastId ?? null, inner: node.type === 'uri' || imagemapMessage ? null : node.type === 'message' ? String(node.text ?? '') : originalData }));
    const link = await getOrCreateAutoTrackedLink(db, { originalUrl: destination, lineAccountId: accountId, templateId, dedupScope: scope });
    const key = link.short_code ?? link.id;
    if (node.type === 'uri' || imagemapMessage) {
      if (broadcastId) {
        const host = new URL(destination).hostname.replace(/^www\./, '');
        const label = host.length > 20 ? `${host.slice(0, 20)}…` : host;
        await db.prepare(`INSERT INTO broadcast_tracked_links (broadcast_id,tracked_link_id,label,created_at) VALUES (?,?,?,?) ON CONFLICT(broadcast_id,tracked_link_id) DO UPDATE SET label=excluded.label`).bind(broadcastId,link.id,label,new Date().toISOString()).run();
      }
      const base = await resolveTrackedLinkBaseUrl(db, workerUrl);
      if (imagemapMessage) {
        const { text: _text, ...action } = rest;
        return { ...action, type: 'uri', linkUri: `${base}/t/${key}` };
      }
      return { ...rest, [node.linkUri !== undefined ? 'linkUri' : 'uri']: `${base}/t/${key}` };
    }
    const data = `tx=${key}`;
    if (data.length > 300) throw new Error('tap_extra_postback_too_long');
    const { text: _text, ...action } = rest;
    return { ...action, type: 'postback', data, ...(node.type === 'message' ? { displayText: node.text } : {}) };
  }
  return Object.fromEntries(await Promise.all(Object.entries(rest).map(async ([key, child]) => [key, await decorateTapExtras(db, child, workerUrl, accountId, templateId, broadcastId)])));
}
export async function handleExtraPostback(db: D1Database, friendId: string, accountId: string | null, data: string, eventId: string): Promise<string | null> {
  const match = /^tx=([A-Za-z0-9_-]+)$/.exec(data);
  if (!match) return null;
  const link = await getTrackedLinkByIdOrShortCode(db, match[1]);
  const extras = link && extrasFromTrackedLink(link);
  if (!link?.is_active || link.line_account_id !== accountId || !extras) throw new Error('tap_extra_not_found');
  const snapshot = JSON.parse(decodeURIComponent(link.dedup_key!.split('|')[1].slice(PREFIX.length)));
  if (typeof snapshot.inner !== 'string') throw new Error('invalid_tap_extra_snapshot');
  const { parseCarouselPostbackData } = await import('../lib/carousel-tap.js');
  const carousel = parseCarouselPostbackData(snapshot.inner);
  if (carousel) {
    const { getTemplateById, hasCarouselTap } = await import('@line-crm/db');
    const template = await getTemplateById(db, carousel.templateId);
    if (!template || template.line_account_id !== accountId) throw new Error('tap_extra_not_found');
    if (template.carousel_tap_limit_mode === 'once' && await hasCarouselTap(db, template.id, friendId)) return snapshot.inner;
  }
  await applyTapExtras(db, friendId, accountId, extras, eventId);
  return snapshot.inner;
}
