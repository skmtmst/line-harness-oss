import { describe, expect, it } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import type { HqTemplateAdapterContext, HqTemplateResolution, HqTemplateSnapshotToken } from './contract.js';
import {
  createTemplateHqTemplateAdapter,
  readMessageTemplateSourceBytes,
  MESSAGE_TEMPLATE_MEDIA_MAX_BYTES,
  MESSAGE_TEMPLATE_TOTAL_MEDIA_MAX_BYTES,
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
    width: 100, height: 50, durationMs: null, r2Key: 'hq-templates/tenant-1/media.png',
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
      r2Key: 'hq-templates/tenant-1/media.png',
      r2KeyPrefix: 'hq-templates/tenant-1',
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
    createTargetR2Key: (media, targetId, ctx) =>
      `media/${ctx.targetAccountId}/${targetId}/${media.versionId}.png`,
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
        url: 'https://target/media/store-a/media-store-a-media:source-media/source-media-v1.png',
      },
    });
    expect(resolverInput).toEqual({ authority: sourceAuthority, templateVersionId: 'version-1' });
    expect(readInput).toMatchObject({
      authority: sourceAuthority,
      templateVersionId: 'version-1',
      binding: { mediaVersionId: 'source-media-v1', versionNo: 1, etag: 'etag-source-v1' },
      maxBytes: 4,
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
      expect(plan.stage[0]?.key).toContain(`media/${accountId}/media-${accountId}`);
      expect(plan.compensateOnDbFailure).toEqual(plan.reconcile);
      const insert = plan.dbCommit.find((statement) => statement.sql.includes('INSERT INTO templates'));
      const storedBody = String(insert?.bindings?.[4]);
      expect(storedBody).toContain(`media-${accountId}`);
      expect(storedBody).toContain(`https://target/media/${accountId}/media-${accountId}/source-media-v1.png`);
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
    store.raw.prepare(
      `INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,created_at)
       VALUES ('existing-media','store-a','image','thanks.png','image/png',4,'media/store-a/current.png','media-created')`,
    ).run();
    store.raw.prepare(
      `INSERT INTO media_versions(id,media_id,version_no,r2_key,mime_type,size_bytes,content_hash,created_at)
       VALUES ('existing-media-v1','existing-media',1,'media/store-a/current.png','image/png',4,?,'media-created')`,
    ).run(contentHash);
    const existingMedia = {
      id: 'existing-media', filename: 'thanks.png', mimeType: 'image/png', sizeBytes: 4,
      r2Key: 'media/store-a/current.png', publicUrl: null, contentHash,
      revision: `media-created:${contentHash}:media/store-a/current.png`, versionNo: 1,
    };
    const resolutions: HqTemplateResolution[] = [
      { sourceId: 'template:source-template', itemKind: 'template', mode: 'overwrite', targetId: 'existing', expectedRevision: 'rev-1' },
      { sourceId: 'media:source-media', itemKind: 'media', mode: 'overwrite', targetId: existingMedia.id, expectedRevision: existingMedia.revision },
    ];
    const plan = await planMessageTemplateDistribution({
      context: context('store-a', resolutions), source: authorizedSource(),
      snapshot: snapshot({
        templates: [{ id: 'existing', name: '来店お礼', updatedAt: 'rev-1' }],
        media: [existingMedia],
      }),
      idMap: { 'template:source-template': 'existing', 'media:source-media': existingMedia.id },
      dependencies: dependencies(),
    });
    const objects = new Map<string, Uint8Array>([[existingMedia.r2Key, new Uint8Array([9, 9, 9, 9])]]);
    for (const staged of plan.stage) objects.set(staged.key, staged.bytes);
    store.raw.prepare("UPDATE templates SET updated_at='rev-2' WHERE id='existing'").run();
    const apply = async () => {
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
        for (const owned of plan.compensateOnDbFailure) objects.delete(owned.key);
        throw error;
      }
    };
    await expect(apply()).rejects.toThrow();
    expect(store.raw.prepare("SELECT message_content,updated_at FROM templates WHERE id='existing'").get())
      .toEqual({ message_content: 'old', updated_at: 'rev-2' });
    expect(store.raw.prepare("SELECT r2_key FROM media WHERE id='existing-media'").get())
      .toEqual({ r2_key: existingMedia.r2Key });
    expect(objects.get(existingMedia.r2Key)).toEqual(new Uint8Array([9, 9, 9, 9]));
    expect(objects.has(plan.stage[0]!.key)).toBe(false);
  });

  it.each(['renamed-target', 'renamed-other', 'unchanged', 'other-account'] as const)('overwrite checks the complete media name inventory atomically: %s', async change => {
    const store = createTestD1();
    try {
      store.raw.prepare("INSERT INTO templates(id,name,message_type,message_content,line_account_id,updated_at) VALUES ('existing','来店お礼','text','old','store-a','rev-1')").run();
      for (const [id, account, filename] of [['existing-media','store-a','thanks.png'], ['other','store-a','other.png'], ['remote','store-b','remote.png']]) {
        store.raw.prepare("INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key,created_at) VALUES (?,?,'image',?,'image/png',4,?,'created')").run(id, account, filename, `media/${account}/${id}.png`);
        store.raw.prepare("INSERT INTO media_versions(id,media_id,version_no,r2_key,mime_type,size_bytes,content_hash,created_at) VALUES (?,?,1,?,'image/png',4,?,'created')").run(`${id}-v1`,id,`media/${account}/${id}.png`,contentHash);
      }
      const key = 'media/store-a/existing-media.png';
      const current = { id: 'existing-media', filename: 'thanks.png', mimeType: 'image/png', sizeBytes: 4, r2Key: key, publicUrl: null, contentHash, revision: `created:${contentHash}:${key}`, versionNo: 1 };
      const other = { ...current, id: 'other', filename: 'other.png', r2Key: 'media/store-a/other.png', contentHash: 'b'.repeat(64) };
      const selections: HqTemplateResolution[] = [
        { sourceId: 'template:source-template', itemKind: 'template', mode: 'overwrite', targetId: 'existing', expectedRevision: 'rev-1' },
        { sourceId: 'media:source-media', itemKind: 'media', mode: 'overwrite', targetId: current.id, expectedRevision: current.revision },
      ];
      const plan = await planMessageTemplateDistribution({ context: context('store-a', selections), source: authorizedSource(), snapshot: snapshot({ templates: [{id:'existing',name:'来店お礼',updatedAt:'rev-1'}], media: [current,other] }), idMap: {'template:source-template':'existing','media:source-media':'existing-media'}, dependencies: dependencies() });
      if (change === 'renamed-target') store.raw.prepare("UPDATE media SET filename='saved-by-other-editor.png' WHERE id='existing-media'").run();
      if (change === 'renamed-other') store.raw.prepare("UPDATE media SET filename='ＴＨＡＮＫＳ．ＰＮＧ' WHERE id='other'").run();
      if (change === 'other-account') store.raw.prepare("UPDATE media SET filename='thanks.png' WHERE id='remote'").run();
      const before = ['templates','media','media_versions','media_usages'].map(table => store.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const apply = () => store.db.batch(plan.dbCommit.map(statement => store.db.prepare(statement.sql).bind(...statement.bindings)));
      if (change.startsWith('renamed')) {
        await expect(apply()).rejects.toThrow();
        expect(['templates','media','media_versions','media_usages'].map(table => store.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(before);
      } else {
        await apply();
        expect(store.raw.prepare("SELECT filename,r2_key FROM media WHERE id='existing-media'").get()).toEqual({filename:'thanks.png',r2_key:plan.stage[0]!.key});
      }
      expect(plan.compensateOnDbFailure).not.toContainEqual(expect.objectContaining({key}));
    } finally { store.raw.close(); }
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

    const foreignDefinition = {
      ...definition,
      media: [{
        ...definition.media[0]!,
        r2Key: 'hq-templates/tenant-2/media.png',
      }],
    };
    const selfConsistentForeignPrefix = createTemplateHqTemplateAdapter(sourceAuthority, dependencies({
      resolveSourceVersion: async () => sourceVersion({
        definitionJson: JSON.stringify(foreignDefinition),
        media: [{
          ...version.media[0]!,
          r2Key: 'hq-templates/tenant-2/media.png',
          r2KeyPrefix: 'hq-templates/tenant-2',
        }],
      }),
    }));
    await expect(selfConsistentForeignPrefix.extractReferences({ templateVersionId: 'version-1', definitionJson: '{}' }))
      .rejects.toMatchObject({ code: 'SOURCE_MEDIA_AUTHORITY_MISMATCH' });
  });

  const definitionWithSizes = (sizes: readonly number[]) => ({
    ...definition,
    template: { ...definition.template, messageContent: JSON.stringify(sizes.map((_,index)=>`sized-${index}`)) },
    media: sizes.map((sizeBytes, index) => ({...definition.media[0]!, id: `sized-${index}`, r2Key: `hq-templates/tenant-1/sized-${index}`, versionId: `sized-v${index}`, publicUrl: null, sizeBytes })),
  });
  it.each(['definition-single','definition-total','binding-single','binding-total'] as const)('rejects %s capacity before any R2 read', async kind => {
    let readCalled = false;
    const tooLarge = kind.endsWith('single') ? [MESSAGE_TEMPLATE_MEDIA_MAX_BYTES + 1] : [MESSAGE_TEMPLATE_MEDIA_MAX_BYTES, MESSAGE_TEMPLATE_MEDIA_MAX_BYTES, 1];
    let version = sourceVersion();
    if (kind.startsWith('definition')) version = sourceVersion({definitionJson: JSON.stringify(definitionWithSizes(tooLarge))});
    else version = sourceVersion({media: tooLarge.map((sizeBytes,index) => ({...version.media[0]!,mediaId:`sized-${index}`,sizeBytes}))});
    const adapter = createTemplateHqTemplateAdapter(sourceAuthority, dependencies({resolveSourceVersion:async()=>version, readSourceObjectIfUnchanged:async()=>{readCalled=true;return null;}}));
    await expect(adapter.extractReferences({templateVersionId:'version-1',definitionJson:'{}'})).rejects.toMatchObject({code:'MEDIA_SIZE_LIMIT',status:422});
    expect(readCalled).toBe(false);
  });
  it('allows declared boundary sizes without allocating file buffers', () => {
    const parsed = parseMessageTemplateDefinition(definitionWithSizes([MESSAGE_TEMPLATE_MEDIA_MAX_BYTES, MESSAGE_TEMPLATE_MEDIA_MAX_BYTES]));
    expect(parsed.media.reduce((sum,media)=>sum+media.sizeBytes,0)).toBe(MESSAGE_TEMPLATE_TOTAL_MEDIA_MAX_BYTES);
  });
  it('rechecks bytes returned by an incorrectly implemented runtime reader', async () => {
    let readLimit: number | undefined;
    await expect(planMessageTemplateDistribution({context:context('store-a',createResolutions()),source:authorizedSource(),snapshot:snapshot(),idMap:{'template:source-template':'new-template','media:source-media':'new-media'},dependencies:dependencies({readSourceObjectIfUnchanged:async input=>{readLimit=input.maxBytes;return {bytes:new Uint8Array(5),etag:'etag-source-v1'};}})})).rejects.toMatchObject({code:'MEDIA_SIZE_LIMIT'});
    expect(readLimit).toBe(4);
  });
  it('reads stream chunks up to the exact actual byte limit', async () => {
    const body = new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));c.close();}});
    expect(await readMessageTemplateSourceBytes(body,4)).toEqual(new Uint8Array([1,2,3,4]));
    expect(body.locked).toBe(false);
  });
  it('cancels an oversized stream before accepting all source bytes', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([1,2,3]));c.enqueue(new Uint8Array([4,5]));},cancel(){cancelled=true;}});
    await expect(readMessageTemplateSourceBytes(body,4)).rejects.toMatchObject({code:'MEDIA_SIZE_LIMIT'});
    expect(cancelled).toBe(true); expect(body.locked).toBe(false);
  });
  it('rejects unbounded runtime read limits without consuming the stream', async () => {
    const body = new ReadableStream<Uint8Array>();
    await expect(readMessageTemplateSourceBytes(body,MESSAGE_TEMPLATE_MEDIA_MAX_BYTES+1)).rejects.toMatchObject({code:'MEDIA_SIZE_LIMIT'});
    expect(body.locked).toBe(false);
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

  it.each([
    ['another account', 'media/store-b/new.png'],
    ['the current object', 'media/store-a/current.png'],
  ])('rejects a target R2 key owned by %s', async (_case, targetR2Key) => {
    const existing = {
      id: 'existing-media', filename: 'thanks.png', mimeType: 'image/png', sizeBytes: 4,
      r2Key: 'media/store-a/current.png', publicUrl: 'https://target/current.png', contentHash,
      revision: 'rev-1', versionNo: 1,
    };
    const resolutions: HqTemplateResolution[] = [
      { sourceId: 'template:source-template', itemKind: 'template', mode: 'create' },
      { sourceId: 'media:source-media', itemKind: 'media', mode: 'overwrite', targetId: existing.id, expectedRevision: existing.revision },
    ];
    await expect(planMessageTemplateDistribution({
      context: context('store-a', resolutions), source: authorizedSource(),
      snapshot: snapshot({ media: [existing] }),
      idMap: { 'template:source-template': 'new-template', 'media:source-media': existing.id },
      dependencies: dependencies({ createTargetR2Key: () => targetR2Key }),
    })).rejects.toMatchObject({ code: 'MEDIA_COPY_INVALID', status: 422 });
  });

  it('rejects two copied media objects that resolve to the same target R2 key', async () => {
    const media = [
      { ...definition.media[0]!, id: 'media-a', filename: 'a.png', r2Key: 'hq-templates/tenant-1/a.png', publicUrl: null, versionId: 'media-a-v1' },
      { ...definition.media[0]!, id: 'media-b', filename: 'b.png', r2Key: 'hq-templates/tenant-1/b.png', publicUrl: null, versionId: 'media-b-v1' },
    ];
    const twoMedia = parseMessageTemplateDefinition({
      ...definition,
      template: { ...definition.template, messageContent: JSON.stringify(['media-a', 'media-b']) },
      media,
    });
    const version = sourceVersion({
      definitionJson: JSON.stringify(twoMedia),
      media: media.map((item) => ({
        tenantId: 'tenant-1', sourceAccountId: 'source-store', templateVersionId: 'version-1',
        mediaId: item.id, mediaVersionId: item.versionId, versionNo: item.versionNo,
        r2Key: item.r2Key, r2KeyPrefix: 'hq-templates/tenant-1', sizeBytes: item.sizeBytes,
        contentHash: item.contentHash, etag: 'etag-source-v1',
      })),
    });
    await expect(planMessageTemplateDistribution({
      context: context('store-a', [
        { sourceId: 'template:source-template', itemKind: 'template', mode: 'create' },
        { sourceId: 'media:media-a', itemKind: 'media', mode: 'create' },
        { sourceId: 'media:media-b', itemKind: 'media', mode: 'create' },
      ]),
      source: authorizedSource(version), snapshot: snapshot(),
      idMap: {
        'template:source-template': 'new-template',
        'media:media-a': 'target-a',
        'media:media-b': 'target-b',
      },
      dependencies: dependencies({ createTargetR2Key: () => 'media/store-a/shared.png' }),
    })).rejects.toMatchObject({ code: 'MEDIA_COPY_INVALID', status: 422 });
  });

  it('rewrites exact structured locators without changing matching substrings in human text', async () => {
    const media = [{
      ...definition.media[0]!, id: 'cat', r2Key: 'hq-templates/tenant-1/cat.png',
      publicUrl: null, versionId: 'cat-v1',
    }];
    const exactDefinition = parseMessageTemplateDefinition({
      ...definition,
      template: {
        ...definition.template,
        messageContent: JSON.stringify({ text: 'catalog and cat pictures', mediaId: 'cat' }),
      },
      media,
    });
    const version = sourceVersion({
      definitionJson: JSON.stringify(exactDefinition),
      media: [{
        ...sourceVersion().media[0]!, mediaId: 'cat', mediaVersionId: 'cat-v1',
        r2Key: 'hq-templates/tenant-1/cat.png',
      }],
    });
    const plan = await planMessageTemplateDistribution({
      context: context('store-a', [
        { sourceId: 'template:source-template', itemKind: 'template', mode: 'create' },
        { sourceId: 'media:cat', itemKind: 'media', mode: 'create' },
      ]),
      source: authorizedSource(version), snapshot: snapshot(),
      idMap: { 'template:source-template': 'new-template', 'media:cat': 'target-cat' },
      dependencies: dependencies(),
    });
    const insert = plan.dbCommit.find((statement) => statement.sql.includes('INSERT INTO templates'))!;
    expect(JSON.parse(String(insert.bindings?.[4]))).toEqual({
      text: 'catalog and cat pictures',
      mediaId: 'target-cat',
    });
  });

  it('offers overwrite and alias for an NFKC-equivalent media filename with different content', async () => {
    const existing = {
      id: 'existing-media', filename: 'ＴＨＡＮＫＳ．ＰＮＧ', mimeType: 'image/png', sizeBytes: 8,
      r2Key: 'media/store-a/existing.png', publicUrl: null, contentHash: 'a'.repeat(64),
      revision: 'rev-existing', versionNo: 3,
    };
    const items = inspectMessageTemplateDefinition(definition, snapshot({ media: [existing] }));
    expect(items[1]).toMatchObject({
      duplicate: true, targetId: existing.id, expectedRevision: existing.revision,
      allowedModes: ['overwrite', 'alias'],
    });

    const overwrite = await planMessageTemplateDistribution({
      context: context('store-a', [
        { sourceId: 'template:source-template', itemKind: 'template', mode: 'create' },
        { sourceId: 'media:source-media', itemKind: 'media', mode: 'overwrite', targetId: existing.id, expectedRevision: existing.revision },
      ]),
      source: authorizedSource(), snapshot: snapshot({ media: [existing] }),
      idMap: { 'template:source-template': 'new-template', 'media:source-media': existing.id },
      dependencies: dependencies(),
    });
    expect(overwrite.dbCommit.some((statement) => statement.sql.includes('UPDATE media SET'))).toBe(true);
    expect(overwrite.stage[0]?.key).not.toBe(existing.r2Key);
    expect(overwrite.compensateOnDbFailure).not.toContainEqual(expect.objectContaining({ key: existing.r2Key }));

    const alias = await planMessageTemplateDistribution({
      context: context('store-a', [
        { sourceId: 'template:source-template', itemKind: 'template', mode: 'create' },
        { sourceId: 'media:source-media', itemKind: 'media', mode: 'alias', targetId: existing.id },
      ]),
      source: authorizedSource(), snapshot: snapshot({ media: [existing] }),
      idMap: { 'template:source-template': 'alias-template', 'media:source-media': 'alias-media' },
      dependencies: dependencies(),
    });
    const mediaInsert = alias.dbCommit.find((statement) => statement.sql.includes('INSERT INTO media\n'))!;
    expect(mediaInsert.bindings?.[3]).toBe('thanks.png (2)');
  });

  it('fails closed when media content and normalized filename match different targets', () => {
    expect(() => inspectMessageTemplateDefinition(definition, snapshot({ media: [
      {
        id: 'content-match', filename: 'other.png', mimeType: 'image/png', sizeBytes: 4,
        r2Key: 'media/store-a/content.png', publicUrl: null, contentHash, revision: 'r1', versionNo: 1,
      },
      {
        id: 'name-match', filename: 'ＴＨＡＮＫＳ．ＰＮＧ', mimeType: 'image/png', sizeBytes: 4,
        r2Key: 'media/store-a/name.png', publicUrl: null, contentHash: 'b'.repeat(64), revision: 'r2', versionNo: 1,
      },
    ] }))).toThrowError(expect.objectContaining({ code: 'AMBIGUOUS_MEDIA', status: 409 }));
  });
});
