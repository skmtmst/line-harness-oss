import { trackedLinkFriendMatches } from './tracked-link-identity.js';
import { PREFIX } from './tap-extra-links.js';
export { extrasFromTrackedLink, validateTapExtraReferences, decorateTapExtras } from './tap-extra-links.js';
import { extrasFromTrackedLink, validateTapExtraReferences, decorateTapExtras } from './tap-extra-links.js';
import { addScore, getOrCreateAutoTrackedLink, getTrackedLinkByIdOrShortCode, validateScenarioActionReferences } from '@line-crm/db';
import { collectTapExtraTagIds, hasTapExtras, tapExtrasError, validateTapExtrasTree, type TapExtras } from '@line-crm/shared';

import { attachTagAndFireSideEffects } from '../features/friends/friend-tag-attach/index.js';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';
export async function applyTapExtras(db: D1Database, friendId: string, accountId: string | null, extras: TapExtras, eventId: string): Promise<void> {
  if (tapExtrasError(extras)) throw new Error('invalid_tap_extras');
  if (!await trackedLinkFriendMatches(db, friendId, accountId)) throw new Error('tap_extra_account_mismatch');
  const ids = [...new Set(extras.tagIds ?? [])];
  if (ids.length && !(await validateScenarioActionReferences(db, accountId, 'tag', { op: 'add', tagIds: ids })).ok) throw new Error('tap_extra_tag_unavailable');
  for (const id of ids) {
    await attachTagAndFireSideEffects(db, friendId, id);
  }
  if (extras.scoreChange) await addScore(db, { friendId, scoreChange: extras.scoreChange, reason: 'ボタンを押したときの加点', idempotencyKey: JSON.stringify(['tapextra', eventId, friendId]) });
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
