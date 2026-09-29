import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTemplate, publishTemplate, saveTemplateDraft } from '../src/templates.js';
import { resolveStepContent } from '../src/scenario-resolve.js';
import { asD1 } from './d1-test-helper.js';

const packageRoot = join(import.meta.dirname, '..');

/** bootstrap.sql は schema.sql + 全マイグレーション適用済みの現行スキーマ。 */
function openMigratedDb(): D1Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES (?, ?, ?, 'token', 'secret')`,
  ).run('account-1', 'channel-1', '店舗1');
  return asD1(sqlite);
}

const step = (templateId: string) => ({
  template_id: templateId,
  message_type: 'text',
  message_content: 'stepの控え',
});

/*
 * #1470/#645 の退行(resolveStepContent の呼び出し元が lineAccountId を渡さず、
 * fail-close でシナリオ配信のテンプレートが一切引かれなくなる)に対する肯定側の
 * 試験。否定側(未公開・別アカウント・引数未指定)は scenario-resolve-fail-close.test.ts
 * にある。ここでは「公開版・同一アカウントなら、実際に本文が引かれる」側を、
 * 本配信が辿る経路(createTemplate → publishTemplate → 複数ステップを順に
 * resolveStepContent → saveTemplateDraft で編集 → 再publish)に沿って、実SQLite
 * (bootstrap.sql)で固定する。
 *
 * #706(Issue): resolveStepContent の第3引数は必須になったが、それで守られるのは
 * 「引数を丸ごと落とす」形の退行だけ(型検査が捕まえる)。ここは「正しい形で
 * 呼んだときに、本当に公開版が届く」という挙動そのものを固定する。
 */
describe('resolveStepContent の肯定側(実SQLite・配信経路)', () => {
  it('配信順に並んだ複数ステップそれぞれで、公開版テンプレートの本文が実際に引かれる', async () => {
    const db = openMigratedDb();

    const created1 = await createTemplate(db, {
      name: 'あいさつ', messageType: 'text', messageContent: '1通目の公開本文', lineAccountId: 'account-1',
    });
    await publishTemplate(db, created1.id, { expectedVersion: 0 });

    const created2 = await createTemplate(db, {
      name: 'フォロー', messageType: 'text', messageContent: '2通目の公開本文', lineAccountId: 'account-1',
    });
    await publishTemplate(db, created2.id, { expectedVersion: 0 });

    // 本配信は scenario_steps を step_order 順に resolveStepContent へ通す。
    // ここではその順序そのものを再現し、それぞれ自分のテンプレートを引くことを確かめる。
    const steps = [step(created1.id), step(created2.id)];
    const resolved = await Promise.all(steps.map((s) => resolveStepContent(db, s, 'account-1')));

    expect(resolved[0].templateIdAtSend).toBe(created1.id);
    expect(resolved[0].messageContent).toBe('1通目の公開本文');
    expect(resolved[1].templateIdAtSend).toBe(created2.id);
    expect(resolved[1].messageContent).toBe('2通目の公開本文');
  });

  it('公開→編集→配信(旧版のまま)→再公開→配信(新版)を一気通貫で固定する', async () => {
    const db = openMigratedDb();

    const created = await createTemplate(db, {
      name: 'あいさつ', messageType: 'text', messageContent: '公開版の本文', lineAccountId: 'account-1',
    });
    await publishTemplate(db, created.id, { expectedVersion: 0 });

    // 公開直後: 公開版が届く。
    const afterPublish = await resolveStepContent(db, step(created.id), 'account-1');
    expect(afterPublish.templateIdAtSend).toBe(created.id);
    expect(afterPublish.messageContent).toBe('公開版の本文');

    // 下書きへ編集。公開版(live列)はまだ変わらない。
    await saveTemplateDraft(db, created.id, { messageContent: '編集中の本文' });

    // 編集直後に配信すると、まだ公開版が届く(下書きは混ざらない)。
    const duringEdit = await resolveStepContent(db, step(created.id), 'account-1');
    expect(duringEdit.templateIdAtSend).toBe(created.id);
    expect(duringEdit.messageContent).toBe('公開版の本文');

    // 再公開してはじめて新しい本文が届く。
    const published = await publishTemplate(db, created.id, { expectedVersion: 1 });
    expect(published.row.published_version).toBe(2);

    const afterRepublish = await resolveStepContent(db, step(created.id), 'account-1');
    expect(afterRepublish.templateIdAtSend).toBe(created.id);
    expect(afterRepublish.messageContent).toBe('編集中の本文');
  });
});
