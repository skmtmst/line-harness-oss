import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../index.js';
import { auditLog } from './audit-log.js';

/**
 * お金が動く操作の記録。
 * 見たいのは「誰が・いつ・何に・何をしたか」が残ること、
 * そして値や個人情報が混ざらないこと。
 */

async function emit(staff: { id: string; role: 'owner' | 'admin' | 'staff' } | null) {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const app = new Hono<Env>();
  app.get('/x', (c) => {
    if (staff) c.set('staff', { ...staff, name: 'N', readOnly: false });
    auditLog(c, 'mileage.rule.update', { kind: 'mileage_rule', id: 'rule-1' });
    return c.json({ ok: true });
  });
  await app.request('/x');
  const line = spy.mock.calls.at(-1)?.[0] as string;
  return JSON.parse(line) as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

describe('auditLog', () => {
  it('誰が・何を・いつ を残す', async () => {
    const entry = await emit({ id: 'staff-9', role: 'admin' });
    expect(entry.tag).toBe('audit');
    expect(entry.action).toBe('mileage.rule.update');
    expect(entry.actorId).toBe('staff-9');
    expect(entry.actorRole).toBe('admin');
    expect(entry.targetKind).toBe('mileage_rule');
    expect(entry.targetId).toBe('rule-1');
    expect(typeof entry.at).toBe('string');
  });

  it('値や個人情報は残さない', async () => {
    const entry = await emit({ id: 'staff-9', role: 'admin' });
    // 記録するキーを固定しておく。増やすときは意識的に増やす。
    expect(Object.keys(entry).sort()).toEqual(
      ['action', 'actorId', 'actorRole', 'at', 'tag', 'targetId', 'targetKind'].sort(),
    );
    // 名前は入れない（個人情報をログへ流さない）
    expect(JSON.stringify(entry)).not.toContain('N');
  });

  it('認証情報が無くても落ちない', async () => {
    const entry = await emit(null);
    expect(entry.actorId).toBe('unknown');
    expect(entry.actorRole).toBe('unknown');
  });
});
