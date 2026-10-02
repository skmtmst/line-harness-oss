import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  IMPORT_SQL_MAX_STATEMENT_BYTES,
  buildImportSql,
  normalizeCode,
  parsePostalCsv,
  splitImportBatches,
} from './fetch-jp-postal-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'fetch-jp-postal-data.mjs');
const fixture = join(here, 'test-data', 'jp-postal-sample.csv');

describe('日本郵便の取込手順（外部通信なし・fixtureで検証）', () => {
  it('無関係文字の除去で有効化しない', () => {
    expect(normalizeCode('060-0000')).toBe('0600000');
    expect(normalizeCode('0600000')).toBe('0600000');
    expect(normalizeCode('１０００００１')).toBe('1000001');
    expect(normalizeCode('abc1000001')).toBeNull();
    expect(normalizeCode('999999')).toBeNull();
  });

  it('重複・不正行を除き、先頭0と複数候補を残す', () => {
    const text = readFileSync(fixture, 'utf8');
    const { rows, skipped } = parsePostalCsv(text);
    expect(rows.length).toBe(4);
    expect(skipped).toBe(2);
    expect(rows.filter((r) => r.code === '1000001').map((r) => r.town).sort()).toEqual([
      '千代田',
      '皇居外苑',
    ]);
    expect(rows.some((r) => r.code === '0600000')).toBe(true);
  });

  it('--from-fileでmanifestと取込SQLを作る', () => {
    const out = mkdtempSync(join(tmpdir(), 'postal-'));
    execFileSync(process.execPath, [script, '--from-file', fixture, '--out', out], {
      stdio: 'pipe',
    });
    const manifestPath = join(out, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const inputBytes = readFileSync(fixture);
    expect(manifest.rowCount).toBe(4);
    expect(manifest.skippedRows).toBe(2);
    expect(manifest.inputSha256).toBe(createHash('sha256').update(inputBytes).digest('hex'));
    expect(manifest.inputBytes).toBe(inputBytes.length);
    const sqlFiles = [manifest.id].map((id) => join(out, `import-${id}.sql`));
    expect(existsSync(sqlFiles[0])).toBe(true);
    const sql = readFileSync(sqlFiles[0], 'utf8');
    expect(sql).toContain('postal_import_manifest');
    expect(sql).toContain(`'${manifest.inputSha256}'`);
    expect(sql).toContain("'0600000'");
    expect(sql).toContain('千代田');
    expect(sql).toContain('皇居外苑');
    expect(sql).not.toContain('999999');
  });

  it('--fetchは直URLなしではRC2で止まり、配布ページ解析でごまかさない', () => {
    try {
      const out = mkdtempSync(join(tmpdir(), 'postal-'));
      execFileSync(process.execPath, [script, '--fetch', '--out', out], { stdio: 'pipe' });
      expect.unreachable('直URLなしの--fetchは止まる');
    } catch (err) {
      expect((err as { status?: number }).status).toBe(2);
    }
  });

  it('取込SQLは80KBごとに区切り、全行を残す', () => {
    const longTown = '町'.repeat(500);
    const rows = Array.from({ length: 60 }, (_, i) => ({
      code: '4520961', prefecture: '愛知県', city: '名古屋市千種区', town: `${longTown}${i}`,
    }));
    const batches = splitImportBatches(rows, 'src', 'at');
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((b) => b.row)).toHaveLength(60);
    for (const batch of batches) {
      const stmt = `INSERT INTO t VALUES ${batch.map((b) => b.text).join(',')};`;
      expect(Buffer.byteLength(stmt, 'utf8')).toBeLessThanOrEqual(IMPORT_SQL_MAX_STATEMENT_BYTES);
    }
    const sql = buildImportSql({
      rows, sourceUrl: 'src', inputSha256: 'sha', inputBytes: 1,
      manifestId: 'jp-x', importedAt: 'at',
    });
    expect(sql).toContain('postal_import_manifest');
    const inserts = sql.split('\n').filter((line) => line.startsWith('INSERT OR REPLACE INTO postal_codes'));
    expect(inserts).toHaveLength(batches.length);
    expect((sql.match(/4520961/g) ?? []).length).toBe(60);
  });
});
