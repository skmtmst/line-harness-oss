import type { HqBroadcastInput } from '@line-crm/shared';
import { StampError } from './visit-stamps.js';

/** 配布済みの同じ統括版だけを使う。別テナント・別店舗の素材は混ぜない。 */
export async function resolveHqBroadcastMaterials(
  db: D1Database, tenantId: string, accountId: string, input: HqBroadcastInput,
): Promise<HqBroadcastInput> {
  const bubbles = input.messageBubbles ? JSON.parse(JSON.stringify(input.messageBubbles)) : (input.messageBubblesJson ? JSON.parse(input.messageBubblesJson) : null);
  if (!bubbles) return input;
  for (const bubble of bubbles) {
    const content = bubble.content;
    if (!content?.hqTemplateId) continue;
    const templateId = content.hqTemplateId, versionId = content.hqTemplateVersionId;
    if (typeof templateId !== 'string' || typeof versionId !== 'string' || !versionId.trim()) {
      throw new StampError('統括のひな形の版を指定してください', 409);
    }
    const source = await db.prepare(`SELECT v.definition_json FROM hq_template_versions v
      JOIN hq_templates t ON t.id=v.template_id AND t.tenant_id=v.tenant_id
      WHERE v.id=? AND v.template_id=? AND v.tenant_id=? AND t.template_type='template' AND t.archived_at IS NULL`)
      .bind(versionId, templateId, tenantId).first<{ definition_json: string }>();
    const distribution = await db.prepare(`SELECT r.preflight_id FROM hq_template_distribution_results r
      JOIN line_accounts a ON a.id=r.target_account_id AND a.tenant_id=r.tenant_id
      WHERE r.tenant_id=? AND r.template_id=? AND r.template_version_id=? AND r.target_account_id=?
        AND r.status='succeeded' AND a.archived_at IS NULL
      ORDER BY julianday(r.finished_at) DESC,r.run_id DESC LIMIT 1`)
      .bind(tenantId, templateId, versionId, accountId).first<{ preflight_id: string }>();
    if (!source || !distribution) throw new StampError('この版のひな形を店舗へ配布してから送信してください', 409);
    const definition = JSON.parse(source.definition_json);
    const resolutions = (await db.prepare(`SELECT source_id,item_kind,target_id FROM hq_template_preflight_resolutions
      WHERE tenant_id=? AND preflight_id=? AND target_account_id=? AND template_id=? AND template_version_id=?`)
      .bind(tenantId, distribution.preflight_id, accountId, templateId, versionId)
      .all<{ source_id: string; item_kind: string; target_id: string | null }>()).results;
    const replacements = new Map<string, string>();
    let localTemplateId: string | null = null;
    for (const resolution of resolutions) {
      if (!resolution.target_id) throw new StampError('店舗の素材の対応を確認してください', 409);
      const sourceId = resolution.source_id.replace(/^[^:]+:/, '');
      replacements.set(sourceId, resolution.target_id);
      if (resolution.item_kind === 'template' && sourceId === definition.template?.id) {
        const table=definition.asset?'broadcast_message_assets':'templates';
        const local = await db.prepare(`SELECT id FROM ${table} WHERE id=? AND line_account_id=?`)
          .bind(resolution.target_id, accountId).first<{ id: string }>();
        if (!local) throw new StampError('店舗のひな形を確認してください', 409);
        localTemplateId = local.id;
      }
      if (resolution.item_kind === 'media') {
        const local = await db.prepare('SELECT public_url FROM media WHERE id=? AND line_account_id=? AND archived_at IS NULL')
          .bind(resolution.target_id, accountId).first<{ public_url: string | null }>();
        const media = definition.media?.find((m: { id: string }) => m.id === sourceId);
        if (!local?.public_url || !media) throw new StampError('店舗の登録メディアを確認してください', 409);
        for (const url of [media.publicUrl, media.r2Key]) if (typeof url === 'string' && url) replacements.set(url, local.public_url);
        if (definition.asset?.kind==='rich_message' && media.publicUrl===definition.asset.payload.baseUrl+'/1040') {
          if (!local.public_url.endsWith('/1040')) throw new StampError('店舗のリッチ素材の画像を確認してください',409);
          replacements.set(definition.asset.payload.baseUrl,local.public_url.slice(0,-5));
        }
      }
    }
    if (!localTemplateId) throw new StampError('店舗のひな形の対応を確認してください', 409);
    // URL、ID、postback 内のIDを置換する。JSONの引用符は文字列の値として保つ。
    const entries = [...replacements].sort(([a], [b]) => b.length - a.length);
    const replace = (value: string) => {
      if (replacements.has(value) && value.includes('/')) return replacements.get(value)!;
      // ID は postback のパラメータ値としてのみ付け替え、本文の普通の単語には触れない。
      return entries.reduce((text, [from, to]) => from.includes('/')
        ? text.split(from).join(to)
        : text.replace(/([?&=])([^&=?]+)(?=&|$)/g, (match, prefix, id) => id === from ? prefix + to : match), value);
    };
    const walk = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string') return /Json$/.test(key) ? JSON.stringify(walk(JSON.parse(value)))
        : /Id$/.test(key) && replacements.has(value) ? replacements.get(value)! : replace(value);
      if (Array.isArray(value)) return value.map(item => walk(item));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /^hqTemplate/.test(k) ? v : walk(v, k)]));
      return value;
    };
    bubble.content = walk(content);
    if (definition.asset) bubble.content.assetId = localTemplateId;
    else if (bubble.type === 'carousel') bubble.content.templateId = localTemplateId;
  }
  return { ...input, messageBubbles: bubbles, messageBubblesJson: undefined };
}
