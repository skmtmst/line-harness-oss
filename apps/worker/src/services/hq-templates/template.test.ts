import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import type { HqTemplateAdapterContext, HqTemplateResolution, HqTemplateSnapshotToken } from './contract.js';
import {
  createTemplateHqTemplateAdapter,
  inspectMessageTemplateDefinition,
  nextMessageTemplateAlias,
  parseMessageTemplateDefinition,
  planMessageTemplateDistribution,
  type AuthorizedMessageTemplateSource,
  type MessageTemplateAdapterDependencies,
  type MessageTemplateSourceAuthority,
  type MessageTemplateSourceVersion,
  type MessageTemplateTargetSnapshot,
} from './template.js';

const token = 'hqts1.snapshot' as HqTemplateSnapshotToken;
const contentHash = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a';
const sourceAuthority: MessageTemplateSourceAuthority = {
  tenantId: 'tenant-1',
  sourceAccountId: 'source-store',
};
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
    contentHash,
  }],
});

function sourceVersion(overrides: Partial<MessageTemplateSourceVersion> = {}): MessageTemplateSourceVersion {
  return {
    tenantId: sourceAuthority.tenantId,
    sourceAccountId: sourceAuthority.sourceAccountId,
    templateVersionId: 'version-1',
    definitionJson: JSON.stringify(definition),
    media: [{
      tenantId: sourceAuthority.tenantId,
      sourceAccountId: sourceAuthority.sourceAccountId,
      templateVersionId: 'version-1',
      mediaId: 'source-media',
      mediaVersionId: 'source-media-v1',
      versionNo: 1,
      r2Key: 'source/media.png',
      r2KeyPrefix: 'source',
      sizeBytes: 4,
      contentHash,
      etag: 'etag-source-v1',
    }],
    ...overrides,
  };
}

function authorizedSource(version = sourceVersion()): AuthorizedMessageTemplateSource {
  return {
    authority: sourceAuthority,
    version,
    definition: parseMessageTemplateDefinition(JSON.parse(version.definitionJson)),
    media: new Map(version.media.map((binding) => [binding.mediaId, binding])),
  };
}

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

function dependencies(overrides: Partial<MessageTemplateAdapterDependencies> = {}): MessageTemplateAdapterDependencies {
  return {
    resolveSourceVersion: async () => sourceVersion(),
    loadTargetSnapshot: async () => snapshot(),
    readSourceObjectIfUnchanged: async () => ({
      bytes: new Uint8Array([1, 2, 3, 4]),
      etag: 'etag-source-v1',
    }),
    createId: (kind, sourceId, ctx) => `${kind}-${ctx.targetAccountId}-${sourceId}`,
    createTargetR2Key: (_media, targetId, ctx) => `accounts/${ctx.targetAccountId}/${targetId}.png`,
    createTargetPublicUrl: (key) => `https://target/${key}`,
    createOwnerToken: (key, ctx) => `${ctx.preflightId}:${key}`,
    now: () => '2026-09-12T12:00:00.000Z',
    ...overrides,
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
    let resolverInput: unknown;
    let readInput: unknown;
    const adapter = createTemplateHqTemplateAdapter(sourceAuthority, dependencies({
      resolveSourceVersion: async (input) => {
        resolverInput = input;
        return sourceVersion();
      },
      readSourceObjectIfUnchanged: async (input) => {
        readInput = input;
        return { bytes: new Uint8Array([1, 2, 3, 4]), etag: 'etag-source-v1' };
      },
    }));
    const ctx = context('store-a', createResolutions());
    const extracted = await adapter.extractReferences({
      templateVersionId: 'version-1',
      definitionJson: JSON.stringify({ forged: true }),
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
    if (ids.kind !== 'OK') return;
    const planned = await adapter.buildCommitPlan(ctx, {
      templateVersionId: 'version-1',
      definitionJson: JSON.stringify({ forged: true }),
    }, ids.value);
    expect(planned.kind).toBe('OK');
    if (planned.kind !== 'OK') return;
    const insert = planned.value.dbCommit.find((statement) => statement.sql.includes('INSERT INTO templates'));
    expect(JSON.parse(String(insert?.bindings?.[4]))).toEqual({
      hero: {
        mediaId: 'media-store-a-media:source-media',
        url: 'https://target/accounts/store-a/media-store-a-media:source-media.png',
      },
    });
    expect(resolverInput).toEqual({ authority: sourceAuthority, templateVersionId: 'version-1' });
    expect(readInput).toMatchObject({
      authority: sourceAuthority,
      templateVersionId: 'version-1',
      binding: { mediaVersionId: 'source-media-v1', versionNo: 1, etag: 'etag-source-v1' },
    });
  });

  it('builds one isolated atomic plan per each of three stores and rewrites media ownership', async () => {
    for (const accountId of ['store-a', 'store-b', 'store-c']) {
      const plan = await planMessageTemplateDistribution({
        context: context(accountId, createResolutions()), source: authorizedSource(),
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
      context: context('store-a', resolutions), source: authorizedSource(), snapshot: targetSnapshot,
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
      context: context('store-a', resolutions), source: authorizedSource(),
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
      context: context('store-a', resolutions), source: authorizedSource(),
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

  it.each(['insert', 'rename', 'unchanged', 'other-account'] as const)('checks the complete name inventory before committing an NFKC name: %s', async (change) => {
    const store = createTestD1({ foreignKeys: true });
    try {
      for (const id of ['store-a', 'store-b']) store.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES (?,?,?,'fixture','fixture')").run(id,id,id);
      const templates = change === 'rename' ? [{ id: 'existing', name: 'Unrelated', updatedAt: 'rev-1' }] : [];
      if (templates.length) store.raw.prepare("INSERT INTO templates(id,name,message_type,message_content,line_account_id,updated_at) VALUES ('existing','Unrelated','text','old','store-a','rev-1')").run();
      const source = authorizedSource(sourceVersion({
        definitionJson: JSON.stringify({ ...definition, template: { ...definition.template, name: 'ＶＩＰ', messageType: 'text', messageContent: 'Synthetic' }, media: [] }),
        media: [],
      }));
      const plan = await planMessageTemplateDistribution({
        context: context('store-a', [{ sourceId: 'template:source-template', itemKind: 'template', mode: 'create' }]),
        source, snapshot: snapshot({ templates }), idMap: { 'template:source-template': 'planned' }, dependencies: dependencies(),
      });
      if (change === 'rename') store.raw.prepare("UPDATE templates SET name='VIP' WHERE id='existing'").run();
      if (change === 'insert' || change === 'other-account') store.raw.prepare("INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES ('concurrent','VIP','text','old',?)").run(change === 'insert' ? 'store-a' : 'store-b');
      const apply = () => store.db.batch(plan.dbCommit.map(statement => store.db.prepare(statement.sql).bind(...statement.bindings)));
      if (change === 'insert' || change === 'rename') {
        await expect(apply()).rejects.toThrow();
        expect(store.raw.prepare("SELECT id FROM templates WHERE id='planned'").get()).toBeUndefined();
      } else {
        await apply();
        expect(store.raw.prepare("SELECT name FROM templates WHERE id='planned'").get()).toEqual({ name: 'ＶＩＰ' });
      }
      expect(store.raw.pragma('foreign_key_check')).toEqual([]);
    } finally { store.raw.close(); }
  });

  it.each(['template', 'media'] as const)('rejects an overwrite id map that points to another %s', async (kind) => {
    const existingMedia = { id: 'existing-media', filename: 'existing.png', mimeType: 'image/png', sizeBytes: 4, r2Key: 'target/existing.png', publicUrl: null, contentHash, revision: 'rev-1', versionNo: 1 };
    const templates = kind === 'template' ? [{ id: 'existing-template', name: definition.template.name, updatedAt: 'rev-1' }, { id: 'other-template', name: 'Other', updatedAt: 'rev-1' }] : [];
    const media = kind === 'media' ? [existingMedia] : [];
    const selections = createResolutions().map(row => row.itemKind === kind ? { ...row, mode: 'overwrite' as const, targetId: `existing-${kind}`, expectedRevision: 'rev-1' } : row);
    let readCalled = false;
    await expect(planMessageTemplateDistribution({
      context: context('store-a', selections), source: authorizedSource(), snapshot: snapshot({ templates, media }),
      idMap: { 'template:source-template': kind === 'template' ? 'other-template' : 'new-template', 'media:source-media': kind === 'media' ? 'other-media' : 'new-media' },
      dependencies: dependencies({ readSourceObjectIfUnchanged: async () => { readCalled = true; return null; } }),
    })).rejects.toMatchObject({ code: 'INVALID_ID_MAP', status: 409 });
    expect(readCalled).toBe(false);
  });

  it.each([`sha256:${contentHash}`, `sha256=${contentHash}`, contentHash.toUpperCase()])('recognizes equivalent media digest representation %s', (hash) => {
    const existing = { id: 'existing-media', filename: 'existing.png', mimeType: 'image/png', sizeBytes: 4, r2Key: 'target/existing.png', publicUrl: null, contentHash: hash, revision: 'rev-1', versionNo: 1 };
    expect(inspectMessageTemplateDefinition(definition, snapshot({ media: [existing] }))[1]).toMatchObject({ duplicate: true, targetId: 'existing-media', allowedModes: ['overwrite', 'alias'] });
    const source = { ...definition, media: [{ ...definition.media[0]!, contentHash: hash }] };
    expect(inspectMessageTemplateDefinition(source, snapshot({ media: [{ ...existing, contentHash }] }))[1]).toMatchObject({ duplicate: true, targetId: 'existing-media' });
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
        contentHash, revision: 'media-rev-1', versionNo: 4,
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
      source: authorizedSource(), snapshot: snapshot(),
      idMap: { 'template:source-template': 'template-a', 'media:source-media': 'media-a' },
      dependencies: dependencies(),
    })).rejects.toMatchObject({ code: 'SELECTION_REQUIRED', status: 409 });
  });

  it('rejects a source version outside the bound tenant, version, or R2 prefix', async () => {
    const wrongTenant = createTemplateHqTemplateAdapter(sourceAuthority, dependencies({
      resolveSourceVersion: async () => sourceVersion({ tenantId: 'tenant-2' }),
    }));
    await expect(wrongTenant.extractReferences({ templateVersionId: 'version-1', definitionJson: '{}' }))
      .rejects.toMatchObject({ code: 'SOURCE_AUTHORITY_MISMATCH' });

    const wrongVersion = createTemplateHqTemplateAdapter(sourceAuthority, dependencies({
      resolveSourceVersion: async () => sourceVersion({ templateVersionId: 'version-2' }),
    }));
    await expect(wrongVersion.extractReferences({ templateVersionId: 'version-1', definitionJson: '{}' }))
      .rejects.toMatchObject({ code: 'SOURCE_AUTHORITY_MISMATCH' });

    const version = sourceVersion();
    const wrongPrefix = createTemplateHqTemplateAdapter(sourceAuthority, dependencies({
      resolveSourceVersion: async () => sourceVersion({
        media: [{ ...version.media[0]!, r2KeyPrefix: 'another-tenant' }],
      }),
    }));
    await expect(wrongPrefix.extractReferences({ templateVersionId: 'version-1', definitionJson: '{}' }))
      .rejects.toMatchObject({ code: 'SOURCE_MEDIA_AUTHORITY_MISMATCH' });
  });

  it('rejects same-size source bytes when their SHA-256 does not match the immutable version', async () => {
    await expect(planMessageTemplateDistribution({
      context: context('store-a', createResolutions()),
      source: authorizedSource(),
      snapshot: snapshot(),
      idMap: { 'template:source-template': 'template-a', 'media:source-media': 'media-a' },
      dependencies: dependencies({
        readSourceObjectIfUnchanged: async () => ({
          bytes: new Uint8Array([4, 3, 2, 1]),
          etag: 'etag-source-v1',
        }),
      }),
    })).rejects.toMatchObject({ code: 'MEDIA_COPY_INVALID', status: 422 });
  });

  it('rejects a conditional R2 read whose etag no longer matches preflight', async () => {
    await expect(planMessageTemplateDistribution({
      context: context('store-a', createResolutions()),
      source: authorizedSource(),
      snapshot: snapshot(),
      idMap: { 'template:source-template': 'template-a', 'media:source-media': 'media-a' },
      dependencies: dependencies({
        readSourceObjectIfUnchanged: async () => ({
          bytes: new Uint8Array([1, 2, 3, 4]),
          etag: 'etag-source-v2',
        }),
      }),
    })).rejects.toMatchObject({ code: 'MEDIA_COPY_INVALID', status: 422 });
  });
});
