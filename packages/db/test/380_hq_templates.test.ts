import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  archiveHqTemplate,
  beginHqTemplateDistributionRun,
  beginHqTemplateStoreResult,
  buildCreateHqTemplateVersionPlan,
  listHqTemplatePreflightResolutions,
  listHqTemplateR2KeysForReconcile,
  listHqTemplates,
  recordHqTemplateOwnedR2Key,
  saveHqTemplatePreflight,
  saveHqTemplatePreflightResolution,
  setHqTemplateOwnedR2KeyState,
  shouldRetryHqTemplateStoreResult,
  transitionHqTemplateStoreResult,
  type HqTemplateDistributionResult,
} from '../src/hq-templates.js';
import { asD1 } from './d1-test-helper.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'migrations/380_hq_templates.sql'), 'utf8');

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(migration);
  const db = asD1(sqlite);
  return { sqlite, db };
}

function seedTemplate(sqlite: Database.Database, tenant: string, template: string, version: string) {
  sqlite.prepare(`INSERT INTO hq_templates (id, tenant_id, template_type, name)
    VALUES (?, ?, 'tag', ?)`).run(template, tenant, template);
  sqlite.prepare(`INSERT INTO hq_template_versions
    (id, tenant_id, template_id, version, definition_json, content_hash)
    VALUES (?, ?, ?, 1, '{}', ?)`).run(version, tenant, template, `hash-${version}`);
}

const preflight = {
  id: 'preflight-1',
  tenantId: 'tenant-a',
  templateId: 'template-a',
  templateVersionId: 'version-a',
  targetAccountId: 'account-a',
  distributionMode: 'overwrite' as const,
  idempotencyFingerprint: 'store-fingerprint-a',
  snapshotToken: 'snapshot-a',
  status: 'ready' as const,
};

const storeBinding = {
  runId: 'run-a',
  tenantId: 'tenant-a',
  templateId: 'template-a',
  templateVersionId: 'version-a',
  targetAccountId: 'account-a',
  preflightId: 'preflight-1',
  idempotencyFingerprint: 'store-fingerprint-a',
  snapshotToken: 'snapshot-a',
};

describe('migration 380: 統括ひな形の基盤', () => {
  test('既存テーブルを変更せず追加し、店舗単位の解決表も作る', () => {
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    const { sqlite } = setup();
    const tables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'hq_template%'`,
    ).all().map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining([
      'hq_templates',
      'hq_template_versions',
      'hq_template_preflights',
      'hq_template_preflight_resolutions',
      'hq_template_distribution_runs',
      'hq_template_distribution_results',
      'hq_template_owned_r2_keys',
    ]));
  });

  test('4種類すべてをtenant単位で保存でき、account_idを要求しない', () => {
    const { sqlite } = setup();
    const insert = sqlite.prepare(
      `INSERT INTO hq_templates (id, tenant_id, template_type, name) VALUES (?, 'tenant-1', ?, ?)`,
    );
    for (const type of ['tag', 'template', 'rich_menu', 'form']) insert.run(`hq-${type}`, type, type);
    expect(sqlite.prepare(`SELECT COUNT(*) FROM hq_templates`).pluck().get()).toBe(4);
    expect(() => insert.run('bad', 'recipe', 'bad')).toThrow(/CHECK constraint failed/);
  });

  test('version作成planはarchivedでない同一tenant/templateだけをCAS更新する', () => {
    const plan = buildCreateHqTemplateVersionPlan({
      id: 'version-2',
      tenantId: 'tenant-1',
      templateId: 'template-1',
      version: 2,
      definitionJson: '{"name":"配布用"}',
      contentHash: 'sha256:content',
      expectedTemplateRevision: 1,
    });
    expect(plan.statements).toHaveLength(2);
    expect(plan.statements[0].sql).toContain('archived_at IS NULL');
    expect(plan.statements[1].sql).toContain('revision = ?');
  });

  test('preflight CASはtenant/fingerprint/snapshotを横断更新せず、解決選択を店舗snapshotへ固定する', async () => {
    const { sqlite, db } = setup();
    seedTemplate(sqlite, 'tenant-a', 'template-a', 'version-a');
    seedTemplate(sqlite, 'tenant-b', 'template-b', 'version-b');

    expect((await saveHqTemplatePreflight(db, preflight)).kind).toBe('saved');
    expect((await saveHqTemplatePreflight(db, {
      ...preflight,
      tenantId: 'tenant-b',
      templateId: 'template-b',
      templateVersionId: 'version-b',
      targetAccountId: 'account-b',
      idempotencyFingerprint: 'store-fingerprint-b',
      snapshotToken: 'snapshot-b',
    })).kind).toBe('saved');

    expect((await saveHqTemplatePreflight(db, {
      ...preflight,
      snapshotToken: 'snapshot-new',
      expectedSnapshotToken: 'stale-snapshot',
    })).kind).toBe('conflict_or_missing');
    expect((await saveHqTemplatePreflight(db, {
      ...preflight,
      id: 'preflight-other-id',
    })).kind).toBe('conflict_or_missing');
    expect(sqlite.prepare(`SELECT snapshot_token FROM hq_template_preflights
      WHERE id = 'preflight-1' AND tenant_id = 'tenant-a'`).pluck().get()).toBe('snapshot-a');

    expect((await saveHqTemplatePreflightResolution(db, {
      preflightId: preflight.id,
      tenantId: preflight.tenantId,
      templateId: preflight.templateId,
      templateVersionId: preflight.templateVersionId,
      targetAccountId: preflight.targetAccountId,
      snapshotToken: preflight.snapshotToken,
      sourceId: 'source-overwrite',
      itemKind: 'tag',
      resolutionMode: 'overwrite',
      targetId: 'target-1',
      expectedRevision: 'revision-4',
    })).kind).toBe('saved');
    expect((await saveHqTemplatePreflightResolution(db, {
      preflightId: preflight.id,
      tenantId: preflight.tenantId,
      templateId: preflight.templateId,
      templateVersionId: preflight.templateVersionId,
      targetAccountId: preflight.targetAccountId,
      snapshotToken: preflight.snapshotToken,
      sourceId: 'source-alias',
      itemKind: 'tag',
      resolutionMode: 'alias',
      aliasName: '本部タグ',
    })).kind).toBe('saved');
    expect((await listHqTemplatePreflightResolutions(db, 'tenant-a', 'preflight-1'))
      .map((row) => row.resolution_mode).sort()).toEqual(['alias', 'overwrite']);
    expect((await saveHqTemplatePreflightResolution(db, {
      preflightId: preflight.id,
      tenantId: preflight.tenantId,
      templateId: preflight.templateId,
      templateVersionId: preflight.templateVersionId,
      targetAccountId: preflight.targetAccountId,
      snapshotToken: 'foreign-snapshot',
      sourceId: 'source-new',
      itemKind: 'tag',
      resolutionMode: 'create',
    })).kind).toBe('conflict_or_missing');
  });

  test('template/version/run/preflightの不一致は複合外部キーで拒否する', async () => {
    const { sqlite, db } = setup();
    seedTemplate(sqlite, 'tenant-a', 'template-a', 'version-a');
    seedTemplate(sqlite, 'tenant-a', 'template-b', 'version-b');
    expect(() => sqlite.prepare(`INSERT INTO hq_template_distribution_runs
      (id, tenant_id, template_id, template_version_id, idempotency_fingerprint, status)
      VALUES ('bad-run', 'tenant-a', 'template-a', 'version-b', 'bad', 'running')`).run())
      .toThrow(/FOREIGN KEY constraint failed/);

    await saveHqTemplatePreflight(db, preflight);
    await beginHqTemplateDistributionRun(db, {
      id: 'run-a',
      tenantId: 'tenant-a',
      templateId: 'template-a',
      templateVersionId: 'version-a',
      idempotencyFingerprint: 'run-fingerprint-a',
    });
    await expect(beginHqTemplateDistributionRun(db, {
      id: 'run-other-id',
      tenantId: 'tenant-a',
      templateId: 'template-a',
      templateVersionId: 'version-a',
      idempotencyFingerprint: 'run-fingerprint-a',
    })).rejects.toThrow(/HQ_TEMPLATE_RUN_BINDING_CONFLICT/);
    expect(() => sqlite.prepare(`INSERT INTO hq_template_distribution_results
      (run_id, tenant_id, template_id, template_version_id, target_account_id, preflight_id,
       idempotency_fingerprint, snapshot_token, status)
      VALUES ('run-a', 'tenant-a', 'template-a', 'version-a', 'account-a', 'preflight-1',
       'store-fingerprint-a', 'wrong-snapshot', 'pending')`).run())
      .toThrow(/FOREIGN KEY constraint failed/);
  });

  test('store CASは競合retryを一度だけ進め、成功後の逆遷移を拒否する', async () => {
    const { sqlite, db } = setup();
    seedTemplate(sqlite, 'tenant-a', 'template-a', 'version-a');
    await saveHqTemplatePreflight(db, preflight);
    await beginHqTemplateDistributionRun(db, {
      id: 'run-a',
      tenantId: 'tenant-a',
      templateId: 'template-a',
      templateVersionId: 'version-a',
      idempotencyFingerprint: 'run-fingerprint-a',
    });

    expect((await beginHqTemplateStoreResult(db, storeBinding)).kind).toBe('created');
    expect((await beginHqTemplateStoreResult(db, storeBinding)).kind).toBe('reused');
    expect(sqlite.prepare(`SELECT status FROM hq_template_preflights
      WHERE id = 'preflight-1' AND tenant_id = 'tenant-a'`).pluck().get()).toBe('consumed');

    const staged = await transitionHqTemplateStoreResult(db, {
      ...storeBinding, expectedStatus: 'pending', status: 'staged',
    });
    expect(staged.kind).toBe('transitioned');
    const stale = await transitionHqTemplateStoreResult(db, {
      ...storeBinding, expectedStatus: 'pending', status: 'failed',
    });
    expect(stale.kind).toBe('conflict_or_missing');
    expect((await transitionHqTemplateStoreResult(db, {
      ...storeBinding, expectedStatus: 'staged', status: 'succeeded',
    })).kind).toBe('transitioned');
    expect((await transitionHqTemplateStoreResult(db, {
      ...storeBinding, expectedStatus: 'succeeded', status: 'failed',
    })).kind).toBe('conflict_or_missing');
    expect(() => sqlite.prepare(
      `UPDATE hq_template_distribution_results SET status = 'failed' WHERE run_id = 'run-a'`,
    ).run()).toThrow(/HQ_TEMPLATE_RESULT_TERMINAL/);
    expect(sqlite.prepare(`SELECT status FROM hq_template_distribution_results`).pluck().get())
      .toBe('succeeded');
  });

  test('R2所有権CASは別ownerを拒否し、cleanedから逆戻りしない', async () => {
    const { sqlite, db } = setup();
    seedTemplate(sqlite, 'tenant-a', 'template-a', 'version-a');
    await saveHqTemplatePreflight(db, preflight);
    await beginHqTemplateDistributionRun(db, {
      id: 'run-a', tenantId: 'tenant-a', templateId: 'template-a',
      templateVersionId: 'version-a', idempotencyFingerprint: 'run-fingerprint-a',
    });
    await beginHqTemplateStoreResult(db, storeBinding);

    const key = { runId: 'run-a', tenantId: 'tenant-a', targetAccountId: 'account-a', objectKey: 'tmp/key' };
    expect(await recordHqTemplateOwnedR2Key(db, { ...key, ownerToken: 'owner-a' })).toBe('recorded');
    expect(await recordHqTemplateOwnedR2Key(db, { ...key, ownerToken: 'owner-b' })).toBe('conflict_or_missing');
    expect(await setHqTemplateOwnedR2KeyState(db, {
      ...key, ownerToken: 'owner-a', expectedState: 'staged', state: 'cleanup_pending',
    })).toBe(true);
    expect(await setHqTemplateOwnedR2KeyState(db, {
      ...key, ownerToken: 'owner-a', expectedState: 'cleanup_pending', state: 'cleaned',
    })).toBe(true);
    expect(await setHqTemplateOwnedR2KeyState(db, {
      ...key, ownerToken: 'owner-a', expectedState: 'cleaned', state: 'staged',
    })).toBe(false);
    expect(() => sqlite.prepare(
      `UPDATE hq_template_owned_r2_keys SET state = 'staged' WHERE object_key = 'tmp/key'`,
    ).run()).toThrow(/HQ_TEMPLATE_R2_INVALID_TRANSITION/);
    expect((await listHqTemplateR2KeysForReconcile(db, 'tenant-a')).length).toBe(0);
  });

  test('archiveは物理削除せずCASで一覧から除外する', async () => {
    const { sqlite, db } = setup();
    seedTemplate(sqlite, 'tenant-a', 'template-a', 'version-a');
    expect((await archiveHqTemplate(db, {
      tenantId: 'tenant-a', id: 'template-a', expectedRevision: 1,
    })).kind).toBe('archived');
    expect((await listHqTemplates(db, 'tenant-a')).length).toBe(0);
    expect(sqlite.prepare(`SELECT COUNT(*) FROM hq_templates WHERE id = 'template-a'`).pluck().get()).toBe(1);
    expect(() => sqlite.prepare(`DELETE FROM hq_templates WHERE id = 'template-a'`).run())
      .toThrow(/HQ_TEMPLATE_USE_LOGICAL_ARCHIVE/);
    expect((await archiveHqTemplate(db, {
      tenantId: 'tenant-a', id: 'template-a', expectedRevision: 1,
    })).kind).toBe('conflict_or_missing');
  });

  test('成功・競合・未対応は再送せず、一時的な失敗だけ再送する', () => {
    const result = (status: HqTemplateDistributionResult['status']) => ({ status }) as HqTemplateDistributionResult;
    expect(shouldRetryHqTemplateStoreResult(null)).toBe(true);
    expect(shouldRetryHqTemplateStoreResult(result('failed'))).toBe(true);
    expect(shouldRetryHqTemplateStoreResult(result('staged'))).toBe(true);
    expect(shouldRetryHqTemplateStoreResult(result('succeeded'))).toBe(false);
    expect(shouldRetryHqTemplateStoreResult(result('version_conflict'))).toBe(false);
    expect(shouldRetryHqTemplateStoreResult(result('unsupported'))).toBe(false);
  });
});
