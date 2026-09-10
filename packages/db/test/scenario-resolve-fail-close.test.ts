import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTemplate, publishTemplate } from '../src/templates.js';
import { resolveStepContent } from '../src/scenario-resolve.js';
import { asD1 } from './d1-test-helper.js';

const packageRoot = join(import.meta.dirname, '..');

/** bootstrap.sql は schema.sql + 全マイグレーション適用済みの現行スキーマ。line_accounts の外部キー先も用意する。 */
function openMigratedDb(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run('account-1', 'channel-1', '店舗1');
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run('account-2', 'channel-2', '店舗2');
  return asD1(sqlite);
}

async function createPublishedTemplate(
  db: D1Database,
  lineAccountId: string | null,
  messageContent = 'テンプレ本文',
) {
  const created = await createTemplate(db, {
    name: 'あいさつ', messageType: 'text', messageContent, lineAccountId,
  });
  const published = await publishTemplate(db, created.id, { expectedVersion: 0 });
  return published.row;
}

const step = (templateId: string) => ({
  template_id: templateId,
  message_type: 'text',
  message_content: 'stepの控え',
});

/*
 * #645 差し戻し(2026-09-09T02:26:35Z)・司令塔独立審査REJECT対応: resolveStepContent の
 * fail-close を実SQLiteで検証する否定試験。scenario-resolve.test.ts(src/)は
 * account-1 で常に一致する肯定側の試験しか無く、未公開・別アカウント・
 * lineAccountId 未指定のどれも拒まれることを確認していなかった
 * (審査者の指摘: 「否定側が一切試験されていない」)。
 */
describe('resolveStepContent の fail-close(実SQLite・否定試験)', () => {
  it('未公開(published_version=0)のテンプレートは解決せず step の控えへ落ちる', async () => {
    const db = openMigratedDb();
    const created = await createTemplate(db, {
      name: 'あいさつ', messageType: 'flex', messageContent: '{"未公開":true}', lineAccountId: 'account-1',
    });
    // publish していないので published_version は 0 のまま。

    const result = await resolveStepContent(db, step(created.id), 'account-1');

    expect(result.templateIdAtSend).toBeNull();
    expect(result.messageType).toBe('text');
    expect(result.messageContent).toBe('stepの控え');
  });

  it('別アカウントの公開版テンプレートは解決せず step の控えへ落ちる', async () => {
    const db = openMigratedDb();
    const tpl = await createPublishedTemplate(db, 'account-1');

    const result = await resolveStepContent(db, step(tpl.id), 'account-2');

    expect(result.templateIdAtSend).toBeNull();
    expect(result.messageContent).toBe('stepの控え');
  });

  it('lineAccountId が渡らなかった(undefined)場合は、公開版・同一アカウントのテンプレートでも解決しない', async () => {
    const db = openMigratedDb();
    const tpl = await createPublishedTemplate(db, 'account-1');

    const result = await resolveStepContent(db, step(tpl.id));

    expect(result.templateIdAtSend).toBeNull();
    expect(result.messageContent).toBe('stepの控え');
  });

  it('lineAccountId に明示的に null が渡った場合も解決しない', async () => {
    const db = openMigratedDb();
    const tpl = await createPublishedTemplate(db, 'account-1');

    const result = await resolveStepContent(db, step(tpl.id), null);

    expect(result.templateIdAtSend).toBeNull();
    expect(result.messageContent).toBe('stepの控え');
  });

  it('テンプレート側の持ち主が NULL(未補完)なら、呼び出し側が同じ account でも解決しない(fail-close)', async () => {
    const db = openMigratedDb();
    const tpl = await createPublishedTemplate(db, null);

    const result = await resolveStepContent(db, step(tpl.id), 'account-1');

    expect(result.templateIdAtSend).toBeNull();
    expect(result.messageContent).toBe('stepの控え');
  });

  it('比較対照: 公開版・同一アカウントが完全一致するときだけテンプレート値を解決する', async () => {
    const db = openMigratedDb();
    const tpl = await createPublishedTemplate(db, 'account-1', '公開済み本文');

    const result = await resolveStepContent(db, step(tpl.id), 'account-1');

    expect(result.templateIdAtSend).toBe(tpl.id);
    expect(result.messageContent).toBe('公開済み本文');
  });
});
