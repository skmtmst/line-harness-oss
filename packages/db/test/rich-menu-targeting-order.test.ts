import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getRichMenuTargetingCandidates } from '../src/rich-menus/index.js';
import { asD1 } from './d1-test-helper.js';

it('実際の表示候補は店舗・公開状態で絞り、優先順と同順位の作成順で返す', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
    raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES ('a','a','A','',''),('b','b','B','','')`);
    const group = raw.prepare(`INSERT INTO rich_menu_groups
      (id,account_id,name,chat_bar_text,size,status,targeting_condition,targeting_priority,targeting_enabled,created_at,updated_at)
      VALUES (?,?,?,'メニュー','large',?,?,?,? ,?,?)`);
    const page = raw.prepare(`INSERT INTO rich_menu_pages
      (id,group_id,order_index,name,alias_id,line_richmenu_id,created_at,updated_at)
      VALUES (?,?,0,?,?,?,'2026-10-01','2026-10-01')`);
    function seed(id: string, priority: number, createdAt: string, options: {
      account?: string; status?: string; enabled?: number; condition?: string | null; registered?: boolean;
    } = {}) {
      group.run(id, options.account ?? 'a', id, options.status ?? 'published',
        options.condition === undefined ? '{"kind":"all"}' : options.condition,
        priority, options.enabled ?? 1, createdAt, createdAt);
      page.run(`page-${id}`, id, id, `alias-${id}`, options.registered === false ? null : `line-${id}`);
    }
    // 同順位は挿入順・ID順に逆らう順序にして、created_atの並びも実際に確かめる。
    seed('a-newer', 1, '2026-10-02');
    seed('z-older', 1, '2026-10-01');
    seed('last', 2, '2026-09-01');
    seed('first', 0, '2026-10-18');
    seed('other', -1, '2026-09-01', { account: 'b' });
    seed('draft', -1, '2026-09-01', { status: 'draft' });
    seed('disabled', -1, '2026-09-01', { enabled: 0 });
    seed('no-condition', -1, '2026-09-01', { condition: null });
    seed('not-registered', -1, '2026-09-01', { registered: false });
    const db = asD1(raw);
    const candidates = await getRichMenuTargetingCandidates(db, 'a');
    expect(candidates.map(row => row.groupId)).toEqual(['first', 'z-older', 'a-newer', 'last']);
    expect(candidates.map(row => row.priority)).toEqual([0, 1, 1, 2]);
    expect((await getRichMenuTargetingCandidates(db, 'b')).map(row => row.groupId)).toEqual(['other']);
  } finally {
    raw.close();
  }
});
