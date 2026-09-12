import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import type { HqTemplateAdapterContext, HqTemplateResolution, HqTemplateSnapshotToken } from './contract.js';
import {
  createTemplateHqTemplateAdapter,
  inspectMessageTemplateDefinition,
  nextMessageTemplateAlias,
  parseMessageTemplateDefinition,
  planMessageTemplateDistribution,
  type MessageTemplateAdapterDependencies,
  type MessageTemplateTargetSnapshot,
} from './template.js';

const token = 'hqts1.snapshot' as HqTemplateSnapshotToken;
const definition = parseMessageTemplateDefinition({
  schemaVersion: 1,
  template: {
    id: 'source-template', name: '来店お礼', category: 'followup', messageType: 'flex',
    messageContent: JSON.stringify({ hero: { mediaId: 'source-media', url: 'https://source/media.png' } }),
    carouselTapLimitMode: 'none', questionStatus: 'published',
  },
  media: [{
    id: 'source-media', kind: 'image', filename: 'thanks.png', mimeType: 'image/png', sizeBytes: 4,
    width: 100, height: 50, durationMs: null, r2Key: 'source/media.png',
    publicUrl: 'https://source/media.png', versionId: 'source-media-v1', versionNo: 1,
    contentHash: 'sha256-image',
  }],
});

function snapshot(overrides: Partial<MessageTemplateTargetSnapshot> = {}): MessageTemplateTargetSnapshot {
  return {
    tenantId: 'tenant-1', targetAccountId: 'store-a', snapshotToken: token,
    templates: [], media: [], ...overrides,
  };
}

function context(account: string, resolutions: readonly HqTemplateResolution[]): HqTemplateAdapterContext {
  return {
    tenantId: 'tenant-1', targetAccountId: account, preflightId: `preflight-${account}`,
    idempotencyFingerprint: `fingerprint-${account}`, mode: 'create', snapshotToken: token, resolutions,
  };
}

function dependencies(): MessageTemplateAdapterDependencies {
  return {
    loadTargetSnapshot: async () => snapshot(),
    readSourceObject: async () => new Uint8Array([1, 2, 3, 4]),
    createId: (kind, sourceId, ctx) => `${kind}-${ctx.targetAccountId}-${sourceId}`,
    createTargetR2Key: (_media, targetId, ctx) => `accounts/${ctx.targetAccountId}/${targetId}.png`,
    createTargetPublicUrl: (key) => `https://target/${key}`,
    createOwnerToken: (key, ctx) => `${ctx.preflightId}:${key}`,
    now: () => '2026-09-12T12:00:00.000Z',
  };
}

function createResolutions(): HqTemplateResolution[] {
  return [
    { sourceId: 'template:source-template', itemKind: 'template', mode: 'create' },
    { sourceId: 'media:source-media', itemKind: 'media', mode: 'create' },
  ];
}

describe('message template HQ adapter', () => {
  it('runs all generic adapter phases with dependency injection', async () => {
    const adapter = createTemplateHqTemplateAdapter(dependencies());
    const ctx = context('store-a', createResolutions());
    const extracted = await adapter.extractReferences({
      templateVersionId: 'version-1',
      definitionJson: JSON.stringify({
        schemaVersion: definition.schemaVersion,
        template: definition.template,
        media: definition.media,
      }),
    });
    expect(extracted.kind).toBe('OK');
    if (extracted.kind !== 'OK') return;
    const verified = await adapter.verifyReferences(ctx, extracted.value);
    expect(verified.kind).toBe('OK');
    if (verified.kind !== 'OK') return;
    const duplicates = await adapter.detectDuplicates(ctx, verified.value);
    expect(duplicates).toEqual({ kind: 'OK', value: [] });
    if (duplicates.kind !== 'OK') return;
    const ids = await adapter.buildIdMap(ctx, verified.value, duplicates.value);
    expect(ids).toMatchObject({
      kind: 'OK',
      value: {
        'template:source-template': 'template-store-a-template:source-template',
        'media:source-media': 'media-store-a-media:source-media',
      },
    });
  });

  it('builds one isolated atomic plan per each of three stores and rewrites media ownership', async () => {
    for (const accountId of ['store-a', 'store-b', 'store-c']) {
      const plan = await planMessageTemplateDistribution({
        context: context(accountId, createResolutions()), definition,
        snapshot: snapshot({ targetAccountId: accountId }),
        idMap: {
          'template:source-template': `template-${accountId}`,
          'media:source-media': `media-${accountId}`,
        },
        dependencies: dependencies(),
      });
      expect(plan.targetAccountId).toBe(accountId);
      expect(plan.stage).toHaveLength(1);
      expect(plan.stage[0]?.key).toContain(`accounts/${accountId}/media-${accountId}`);
      expect(plan.compensateOnDbFailure).toEqual(plan.reconcile);
      const insert = plan.dbCommit.find((statement) => statement.sql.includes('INSERT INTO templates'));
      const storedBody = String(insert?.bindings?.[4]);
      expect(storedBody).toContain(`media-${accountId}`);
      expect(storedBody).toContain(`https://target/accounts/${accountId}/media-${accountId}.png`);
    }
  });

  it('keeps the target id on same-name overwrite and guards its updated_at revision', async () => {
    const target = { id: 'existing-template', name: '来店お礼', updatedAt: 'rev-1' };
    const targetSnapshot = snapshot({ templates: [target] });
    expect(inspectMessageTemplateDefinition(definition, targetSnapshot)[0]).toMatchObject({
      targetId: target.id, duplicate: true, expectedRevision: 'rev-1',
    });
    const resolutions: HqTemplateResolution[] = [
      { sourceId: 'template:source-template', itemKind: 'template', mode: 'overwrite', targetId: target.id, expectedRevision: 'rev-1' },
      { sourceId: 'media:source-media', itemKind: 'media', mode: 'create' },
    ];
    const plan = await planMessageTemplateDistribution({
      context: context('store-a', resolutions), definition, snapshot: targetSnapshot,
      idMap: { 'template:source-template': target.id, 'media:source-media': 'new-media' },
      dependencies: dependencies(),
    });
    const update = plan.dbCommit.find((statement) => statement.sql.includes('UPDATE templates SET'));
    expect(update?.bindings).toContain(target.id);
    expect(update?.bindings).toContain('rev-1');
    expect(plan.dbCommit.some((statement) => statement.sql.includes('updated_at = ?'))).toBe(true);
  });

  it('rejects a stale overwrite before it can create a commit plan', async () => {
    const resolutions: HqTemplateResolution[] = [
      { sourceId: 'template:source-template', itemKind: 'template', mode: 'overwrite', targetId: 'existing', expectedRevision: 'rev-1' },
      { sourceId: 'media:source-media', itemKind: 'media', mode: 'create' },
    ];
    await expect(planMessageTemplateDistribution({
      context: context('store-a', resolutions), definition,
      snapshot: snapshot({ templates: [{ id: 'existing', name: '来店お礼', updatedAt: 'rev-2' }] }),
      idMap: { 'template:source-template': 'existing', 'media:source-media': 'new-media' },
      dependencies: dependencies(),
    })).rejects.toMatchObject({ code: '配布先で編集がありました。もう一度確認してください', status: 409 });
  });

  it('rolls the whole store batch back when updated_at changes after preflight', async () => {
    const store = createTestD1();
    store.raw.prepare(
      `INSERT INTO templates(id,name,message_type,message_content,line_account_id,updated_at)
       VALUES ('existing','来店お礼','text','old','store-a','rev-1')`,
    ).run();
    const resolutions: HqTemplateResolution[] = [
      { sourceId: 'template:source-template', itemKind: 'template', mode: 'overwrite', targetId: 'existing', expectedRevision: 'rev-1' },
      { sourceId: 'media:source-media', itemKind: 'media', mode: 'create' },
    ];
    const plan = await planMessageTemplateDistribution({
      context: context('store-a', resolutions), definition,
      snapshot: snapshot({ templates: [{ id: 'existing', name: '来店お礼', updatedAt: 'rev-1' }] }),
      idMap: { 'template:source-template': 'existing', 'media:source-media': 'new-media' },
      dependencies: dependencies(),
    });
    store.raw.prepare("UPDATE templates SET updated_at='rev-2' WHERE id='existing'").run();
    const apply = () => {
      store.raw.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of plan.dbCommit) {
          const prepared = store.raw.prepare(statement.sql);
          if (/^\s*SELECT/i.test(statement.sql)) prepared.all(...(statement.bindings ?? []) as never[]);
          else prepared.run(...(statement.bindings ?? []) as never[]);
        }
        store.raw.exec('COMMIT');
      } catch (error) {
        store.raw.exec('ROLLBACK');
        throw error;
      }
    };
    expect(apply).toThrow();
    expect(store.raw.prepare("SELECT message_content,updated_at FROM templates WHERE id='existing'").get())
      .toEqual({ message_content: 'old', updated_at: 'rev-2' });
    expect(store.raw.prepare("SELECT COUNT(*) AS count FROM media WHERE line_account_id='store-a'").get())
      .toEqual({ count: 0 });
  });

  it('allocates the first free deterministic alias, including (2) and (3)', () => {
    expect(nextMessageTemplateAlias('来店お礼', ['来店お礼'])).toBe('来店お礼 (2)');
    expect(nextMessageTemplateAlias('来店お礼', ['来店お礼', '来店お礼 (2)'])).toBe('来店お礼 (3)');
  });

  it('includes referenced media duplicates in preflight', () => {
    const items = inspectMessageTemplateDefinition(definition, snapshot({
      media: [{
        id: 'existing-media', filename: 'existing.png', mimeType: 'image/png', sizeBytes: 4,
        r2Key: 'target/existing.png', publicUrl: 'https://target/existing.png',
        contentHash: 'sha256-image', revision: 'media-rev-1', versionNo: 4,
      }],
    }));
    expect(items[1]).toMatchObject({
      sourceId: 'media:source-media', itemKind: 'media', targetId: 'existing-media',
      duplicate: true, expectedRevision: 'media-rev-1', allowedModes: ['overwrite', 'alias'],
    });
  });

  it('rejects incomplete per-store preflight selections', async () => {
    await expect(planMessageTemplateDistribution({
      context: context('store-a', [{ sourceId: 'template:source-template', itemKind: 'template', mode: 'create' }]),
      definition, snapshot: snapshot(),
      idMap: { 'template:source-template': 'template-a', 'media:source-media': 'media-a' },
      dependencies: dependencies(),
    })).rejects.toMatchObject({ code: 'SELECTION_REQUIRED', status: 409 });
  });
});
