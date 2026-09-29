/*
 * R237: テンプレート参照の解決が「公開版・通の控え」のどれかと、
 * 控えに落ちた理由を返す。一括プレビューと配信が同じ解決を見る。
 *
 * 配信の動きは変えない（公開版が使えるときは従来どおり公開版）。
 */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { resolveStepContent } from './scenario-resolve.js';

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run())) as T;
    },
  } as unknown as D1Database;
}

function setup() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE templates (
    id TEXT PRIMARY KEY, message_type TEXT, message_content TEXT, question_json TEXT,
    published_version INTEGER DEFAULT 0, line_account_id TEXT
  )`);
  return asD1(sqlite);
}

function insertTemplate(
  db: D1Database,
  row: { id: string; published_version: number; line_account_id: string | null },
) {
  return (db.prepare(
    `INSERT INTO templates (id, message_type, message_content, question_json, published_version, line_account_id)
     VALUES (?, 'text', '公開版の本文', NULL, ?, ?)`,
  ) as unknown as { bind: (...a: unknown[]) => { run: () => Promise<unknown> } })
    .bind(row.id, row.published_version, row.line_account_id)
    .run();
}

const directStep = {
  template_id: null,
  message_type: 'text',
  message_content: '通の控え',
};

describe('R237: 解決の出どころと控えの理由', () => {
  it('公開版が使えるときはテンプレートを解決する', async () => {
    const db = setup();
    await insertTemplate(db, { id: 'tpl-1', published_version: 2, line_account_id: 'acc-1' });
    const resolved = await resolveStepContent(db, { ...directStep, template_id: 'tpl-1' }, 'acc-1');
    expect(resolved.templateIdAtSend).toBe('tpl-1');
    expect(resolved.messageContent).toBe('公開版の本文');
    expect(resolved.fallbackReason).toBeNull();
  });

  it('template 参照が無い通は控えが正規（理由なし）', async () => {
    const db = setup();
    const resolved = await resolveStepContent(db, directStep, 'acc-1');
    expect(resolved.templateIdAtSend).toBeNull();
    expect(resolved.messageContent).toBe('通の控え');
    expect(resolved.fallbackReason).toBeNull();
  });

  it('未公開のテンプレートは控えを使い、理由を未公開にする', async () => {
    const db = setup();
    await insertTemplate(db, { id: 'tpl-1', published_version: 0, line_account_id: 'acc-1' });
    const resolved = await resolveStepContent(db, { ...directStep, template_id: 'tpl-1' }, 'acc-1');
    expect(resolved.templateIdAtSend).toBeNull();
    expect(resolved.messageContent).toBe('通の控え');
    expect(resolved.fallbackReason).toBe('unpublished');
  });

  it('消えたテンプレートは控えを使い、理由を削除にする', async () => {
    const db = setup();
    const resolved = await resolveStepContent(db, { ...directStep, template_id: 'tpl-gone' }, 'acc-1');
    expect(resolved.templateIdAtSend).toBeNull();
    expect(resolved.fallbackReason).toBe('missing');
  });

  it('別アカウントの公開版は控えを使い、理由を別アカウントにする', async () => {
    const db = setup();
    await insertTemplate(db, { id: 'tpl-1', published_version: 3, line_account_id: 'acc-9' });
    const resolved = await resolveStepContent(db, { ...directStep, template_id: 'tpl-1' }, 'acc-1');
    expect(resolved.templateIdAtSend).toBeNull();
    expect(resolved.fallbackReason).toBe('other_account');
  });
});
