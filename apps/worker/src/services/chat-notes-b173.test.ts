import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSegmentQuery } from '@line-crm/db';
import { emptyLayout } from '@line-crm/shared';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { applyFormLayoutEffects } from './form-layout-effects.js';
import { compileSavedSearch } from './saved-search-filter.js';

let sql: ReturnType<typeof createTestD1>;
beforeEach(() => {
  sql = createTestD1();
  sql.raw.exec(`INSERT INTO friends (id,line_user_id,private_memo) VALUES
    ('f1','u1','古い個別メモ'),('f2','u2','受信箱の検索語'),('f3','u3',NULL);
    INSERT INTO chats(id,friend_id,notes,created_at,updated_at) VALUES ('c1','f1','受信箱の検索語','2026-10-09','2026-10-09');`);
});
afterEach(() => sql.raw.close());

describe('B-173 受信箱のメモへ統一', () => {
  it.each(['f1', 'f3'])('%s のフォーム回答を受信箱へ入れ、旧メモは移行まで保持する', async friendId => {
    const layout = emptyLayout();
    layout.sections[0].blocks = [{ id: 'memo', kind: 'input', type: 'textarea', name: 'memo', label: 'メモ', destinations: { note: true } }];
    const before = sql.raw.prepare('SELECT private_memo FROM friends WHERE id=?').get(friendId);
    const result = await applyFormLayoutEffects({ db: sql.db, layout, friendId, answers: { memo: '新しい回答' } });
    expect(result.destinationWrites).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(sql.raw.prepare('SELECT notes FROM chats WHERE friend_id=?').get(friendId)).toEqual({ notes: friendId === 'f1' ? '受信箱の検索語\n新しい回答' : '新しい回答' });
    expect(sql.raw.prepare('SELECT private_memo FROM friends WHERE id=?').get(friendId)).toEqual(before);
  });

  it('一覧・配信のメモ条件は受信箱だけを見る', () => {
    const query = buildSegmentQuery({ operator: 'AND', rules: [{ type: 'private_memo', value: '受信箱の検索語' }] });
    expect(sql.raw.prepare(query.sql).all(...query.bindings).map((r: any) => r.id)).toEqual(['f1']);
  });

  it.each(['contains', 'eq', 'exists', 'not_exists'] as const)('保存した検索の %s も受信箱を見る', op => {
    const compiled = compileSavedSearch({ all: [{ kind: 'memo', op, value: '受信箱の検索語' }] });
    if (!compiled.ok) throw new Error(compiled.error);
    const ids = sql.raw.prepare(`SELECT f.id FROM friends f WHERE ${compiled.value.sql} ORDER BY f.id`).all(...compiled.value.binds).map((r: any) => r.id);
    expect(ids).toEqual(op === 'not_exists' ? ['f2','f3'] : ['f1']);
  });
});
