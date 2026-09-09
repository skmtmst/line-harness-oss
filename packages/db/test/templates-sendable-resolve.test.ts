import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTemplate, publishTemplate } from '../src/templates.js';
import { resolveStepContent } from '../src/scenario-resolve.js';
import { asD1 } from './d1-test-helper.js';

const packageRoot = join(import.meta.dirname, '..');

/**
 * 実DBで確かめる送信時の解決(再審査2)。
 * 未公開・別アカウントのテンプレートは step の控えに落とし、送らない。
 */
function openDb(): { db: D1Database; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  return { db: asD1(sqlite), sqlite };
}

describe('実DB: 未公開・別アカウントは step の控えに落とす', () => {
  it('未公開の下書きは送らず、step の控えを使う', async () => {
    const { db } = openDb();
    const created = await createTemplate(db, {
      name: '未公開', messageType: 'text', messageContent: '未公開の本文',
    });

    const resolved = await resolveStepContent(db, {
      template_id: created.id,
      message_type: 'text',
      message_content: 'step の控え',
    });
    expect(resolved.messageContent).toBe('step の控え');
    expect(resolved.templateIdAtSend).toBeNull();
  });

  it('公開版は解決し、template_id を送った記録に残す', async () => {
    const { db } = openDb();
    const created = await createTemplate(db, {
      name: '公開する', messageType: 'text', messageContent: '公開版の本文',
    });
    await publishTemplate(db, created.id, { idempotencyKey: 'resolve-publish-1' });

    const resolved = await resolveStepContent(db, {
      template_id: created.id,
      message_type: 'text',
      message_content: 'step の控え',
    });
    expect(resolved.messageContent).toBe('公開版の本文');
    expect(resolved.templateIdAtSend).toBe(created.id);
  });

  it('別アカウントの公開版は送らず、step の控えを使う', async () => {
    const { db, sqlite } = openDb();
    const created = await createTemplate(db, {
      name: '別持ち主', messageType: 'text', messageContent: '別の本文',
    });
    await publishTemplate(db, created.id, { idempotencyKey: 'resolve-publish-2' });
    // 持ち主を直接付ける(口では持ち主必須のため、ここだけSQLで用意する)。
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-9', 'channel-9', '別', 'token', 'secret')`,
    ).run();
    sqlite.prepare(`UPDATE templates SET line_account_id = 'account-9' WHERE id = ?`).run(created.id);

    const resolved = await resolveStepContent(db, {
      template_id: created.id,
      message_type: 'text',
      message_content: 'step の控え',
    }, 'account-1');
    expect(resolved.messageContent).toBe('step の控え');
    expect(resolved.templateIdAtSend).toBeNull();

    // 同じ持ち主なら解決する。
    const same = await resolveStepContent(db, {
      template_id: created.id,
      message_type: 'text',
      message_content: 'step の控え',
    }, 'account-9');
    expect(same.messageContent).toBe('別の本文');
    expect(same.templateIdAtSend).toBe(created.id);
  });
});
