import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCreateHqTemplateVersionPlan,
  shouldRetryHqTemplateStoreResult,
  type HqTemplateDistributionResult,
} from '../src/hq-templates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'migrations/380_hq_templates.sql'), 'utf8');

describe('migration 380: 統括ひな形の基盤', () => {
  test('既存テーブルを変更せず新規テーブルとindexだけを作る', () => {
    expect(migration).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);

    const sqlite = new Database(':memory:');
    sqlite.exec(`CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
    sqlite.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', '既存')`).run();
    sqlite.exec(migration);

    const tables = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'hq_template%'`,
    ).all().map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining([
      'hq_templates',
      'hq_template_versions',
      'hq_template_preflights',
      'hq_template_distribution_runs',
      'hq_template_distribution_results',
      'hq_template_owned_r2_keys',
    ]));
    expect(sqlite.prepare(`SELECT name FROM tags WHERE id = 'tag-1'`).pluck().get()).toBe('既存');
  });

  test('4種類すべてをtenant単位で保存でき、account_idを要求しない', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(migration);
    const insert = sqlite.prepare(
      `INSERT INTO hq_templates (id, tenant_id, template_type, name)
       VALUES (?, 'tenant-1', ?, ?)`,
    );
    for (const type of ['tag', 'template', 'rich_menu', 'form']) {
      insert.run(`hq-${type}`, type, type);
    }
    expect(sqlite.prepare(`SELECT COUNT(*) FROM hq_templates`).pluck().get()).toBe(4);
    expect(() => insert.run('bad', 'recipe', 'bad')).toThrow(/CHECK constraint failed/);
  });

  test('version作成は呼出側の同一batchへ入れられるstatement planを返す', () => {
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
    expect(plan.statements[0].sql).toContain('INSERT INTO hq_template_versions');
    expect(plan.statements[1].sql).toContain('UPDATE hq_templates');
    expect(plan.statements[1].bindings).toContain(1);
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
