/*
 * migration 379: フォームの編集の版(#723)。
 *
 * `bootstrap.sql` をそのまま流すので、migration 259 のトリガ（来訪・回答で
 * `forms.revision` を増やす）も入った状態で実物の `updateForm` を通す。
 * 調査で測った壊れ方（後勝ちで黙って消える）の逆を見張る。
 */
import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFormById, getFormDeleteImpact, updateForm } from '../src/forms.js';

/*
 * 共通の `d1-test-helper` は batch の中で `run()` しか呼ばないので、
 * `getFormDeleteImpact` の batch SELECT が空になる。読みを含む batch を
 * 扱える形（form-delete-impact.test.ts と同じ）をここに置く。
 */
function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const prepared = () => sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const statement = prepared();
              if (statement.reader) {
                return { success: true, results: statement.all(...params), meta: {} };
              }
              const result = statement.run(...params);
              return { success: true, results: [], meta: { changes: result.changes } };
            },
            async first<T>() {
              return (prepared().get(...params) as T) ?? null;
            },
            async all<T>() {
              return { success: true, results: prepared().all(...params) as T[], meta: {} };
            },
          };
        },
      };
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPENED = '2026-09-11T00:00:00.000+09:00';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(root, 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('acc-1', 'ch-1', '本店', 't', 's')`,
  ).run();
  sqlite.prepare(
    `INSERT INTO forms (id, name, description, fields, layout, is_active, created_at, updated_at)
     VALUES ('form-1', '元の名前', '元の説明', '[]', NULL, 1, ?, ?)`,
  ).run(OPENED, OPENED);
  sqlite.prepare(
    `INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-1', 'acc-1')`,
  ).run();
  db = asD1(sqlite);
});

function row() {
  return sqlite.prepare(
    `SELECT name, description, is_active, revision, content_revision FROM forms WHERE id = 'form-1'`,
  ).get() as {
    name: string; description: string | null; is_active: number;
    revision: number; content_revision: number;
  };
}

const FULL = {
  name: '',
  description: null as string | null,
  layout: null as string | null,
  onSubmitTagId: null as string | null,
  isActive: true,
  ogTitle: null as string | null,
  ogDescription: null as string | null,
  ogImageUrl: null as string | null,
};

describe('forms.content_revision（編集の版）', () => {
  test('2人が同じ版を読んで保存すると、後の人が conflict になり先の変更が残る', async () => {
    const aRead = (await getFormById(db, 'form-1'))!;
    const bRead = (await getFormById(db, 'form-1'))!;
    expect(aRead.content_revision).toBe(bRead.content_revision);

    const a = await updateForm(
      db, 'form-1',
      { ...FULL, name: 'Aさんが直した名前', description: 'Aさんの説明' },
      aRead.content_revision,
    );
    expect(a.kind).toBe('updated');

    // Bさんは開いた時点の版のまま保存しようとする。
    const b = await updateForm(
      db, 'form-1',
      { ...FULL, name: 'Bさんが直した名前', description: bRead.description },
      bRead.content_revision,
    );
    expect(b.kind).toBe('conflict');
    if (b.kind === 'conflict') {
      // 画面が「いつ保存されたか」を出せるよう、最新の姿を返す。
      expect(b.form.content_revision).toBe(aRead.content_revision + 1);
    }

    // Aさんの変更が残っている。Bさんの内容は1文字も入っていない。
    expect(row().name).toBe('Aさんが直した名前');
    expect(row().description).toBe('Aさんの説明');
  });

  test('来訪・回答では content_revision が動かない（revision は動く）', async () => {
    const before = row();
    sqlite.prepare(
      `INSERT INTO form_opens (id, form_id, opened_at) VALUES ('open-1', 'form-1', ?)`,
    ).run(OPENED);
    const afterOpen = row();
    sqlite.prepare(
      `INSERT INTO form_submissions (id, form_id, data, created_at) VALUES ('sub-1', 'form-1', '{}', ?)`,
    ).run(OPENED);
    const afterSubmit = row();

    // migration 259 の意図どおり、影響の版は進む。
    expect(afterOpen.revision).toBe(before.revision + 1);
    expect(afterSubmit.revision).toBe(afterOpen.revision + 1);
    // 編集の版は動かない。ここが動くと、誰も編集していないのに 409 になる。
    expect(afterOpen.content_revision).toBe(before.content_revision);
    expect(afterSubmit.content_revision).toBe(before.content_revision);

    // だから来訪のあとでも、開いた時点の版でそのまま保存できる。
    const saved = await updateForm(
      db, 'form-1', { ...FULL, name: '来訪後でも保存できる' }, before.content_revision,
    );
    expect(saved.kind).toBe('updated');
    expect(row().name).toBe('来訪後でも保存できる');
  });

  test('保存が通ると編集の版が1つだけ進む', async () => {
    const before = row().content_revision;
    const saved = await updateForm(db, 'form-1', { ...FULL, name: '新しい名前' }, before);
    expect(saved.kind).toBe('updated');
    if (saved.kind === 'updated') expect(saved.form.content_revision).toBe(before + 1);
    expect(row().content_revision).toBe(before + 1);
    // 同じ版をもう一度送っても通らない。
    expect((await updateForm(db, 'form-1', { ...FULL, name: 'もう一度' }, before)).kind).toBe('conflict');
    expect(row().name).toBe('新しい名前');
  });

  test('1項目だけの更新（受付停止）も版を要求し、版を増やす', async () => {
    const before = row().content_revision;
    // 受付停止は isActive だけを送る。ここを免除すると、止めたはずのフォームが
    // 編集画面の保存で公開中に戻る。
    const stale = await updateForm(db, 'form-1', { isActive: false }, before + 5);
    expect(stale.kind).toBe('conflict');
    expect(row().is_active).toBe(1);

    const stopped = await updateForm(db, 'form-1', { isActive: false }, before);
    expect(stopped.kind).toBe('updated');
    expect(row().is_active).toBe(0);
    expect(row().content_revision).toBe(before + 1);

    // そのあと編集画面が古い版で保存しようとすると通らない。
    // （通ると公開中に戻ってしまう）
    const editorSave = await updateForm(db, 'form-1', { ...FULL, isActive: true }, before);
    expect(editorSave.kind).toBe('conflict');
    expect(row().is_active).toBe(0);
  });

  test('送られなかった項目は今ある値のまま残る', async () => {
    sqlite.prepare(
      `UPDATE forms SET on_submit_webhook_url = 'https://example.test/hook',
         save_to_metadata = 0 WHERE id = 'form-1'`,
    ).run();
    const current = (await getFormById(db, 'form-1'))!;
    const saved = await updateForm(
      db, 'form-1', { ...FULL, name: '名前だけ直す' }, current.content_revision,
    );
    expect(saved.kind).toBe('updated');
    const after = (await getFormById(db, 'form-1'))!;
    expect(after.name).toBe('名前だけ直す');
    expect(after.on_submit_webhook_url).toBe('https://example.test/hook');
    expect(after.save_to_metadata).toBe(0);
  });

  test('無い フォームは not_found。conflict と分ける', async () => {
    expect((await updateForm(db, 'missing', { ...FULL, name: 'x' }, 1)).kind).toBe('not_found');
  });

  test('削除影響は編集の版も返す（受付停止がここから渡す）', async () => {
    const impact = await getFormDeleteImpact(db, 'form-1', 'acc-1');
    expect(impact).not.toBeNull();
    expect(impact!.contentRevision).toBe(row().content_revision);
    // 影響の版と編集の版は別物。来訪が入ると片方だけ動く。
    sqlite.prepare(
      `INSERT INTO form_opens (id, form_id, opened_at) VALUES ('open-2', 'form-1', ?)`,
    ).run(OPENED);
    const again = await getFormDeleteImpact(db, 'form-1', 'acc-1');
    expect(again!.revision).toBe(impact!.revision + 1);
    expect(again!.contentRevision).toBe(impact!.contentRevision);
  });

  test('content_revision は1以上に縛られている', () => {
    expect(() =>
      sqlite.prepare(`UPDATE forms SET content_revision = 0 WHERE id = 'form-1'`).run(),
    ).toThrow(/CHECK constraint failed/);
  });
});
