import { describe, expect, it } from 'vitest';
import { selectAssignment, seededAssignmentRandom, type AssignmentCandidate } from './booking-assignment-selector.js';
const candidate = (id: string, extra: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
  id, periodCount: 0, dailyCount: 0, dailyLimit: null, priority: 'normal', sortOrder: 0, ...extra,
});
describe('担当者と卓の共通の選択', () => {
  it('均等は少ない件数、同点は優先度、それも同点なら乱数で選ぶ', () => {
    const pool = [candidate('a', { periodCount: 1, priority: 'preferred' }), candidate('b'), candidate('c', { priority: 'low' })];
    expect(selectAssignment(pool, { method: 'balanced', random: () => 0.99 })?.id).toBe('b');
    expect(selectAssignment([candidate('a'), candidate('b')], { method: 'balanced', random: () => 0.99 })?.id).toBe('b');
  });
  it('同件数・同優先度は最後に受けた予約が古い順、未担当を先にする', () => {
    const a = candidate('a', { lastAssignedAt: '2026-01-02T00:00:00Z' });
    const b = candidate('b', { lastAssignedAt: '2026-01-01T00:00:00Z' });
    expect(selectAssignment([a,b], {method:'balanced',random:()=>0})?.id).toBe('b');
    expect(selectAssignment([a,b,candidate('new')], {method:'balanced'})?.id).toBe('new');
    expect(selectAssignment([a,{...b,priority:'low'}], {method:'balanced'})?.id).toBe('a');
  });
  it('優先順は指定した順番、同じ順位なら優先度を使う', () => {
    expect(selectAssignment([candidate('a', { sortOrder: 3 }), candidate('b', { periodCount: 20, sortOrder: 1 })], { method: 'priority' })?.id).toBe('b');
    expect(selectAssignment([candidate('a'), candidate('b', { priority: 'preferred' })], { method: 'priority' })?.id).toBe('b');
  });
  it('ランダムは種で再現でき、件数と優先順に偏らない', () => {
    const pool = [candidate('a', { periodCount: 100, priority: 'low', sortOrder: 10 }), candidate('b')];
    const picks = (seed: number) => { const random = seededAssignmentRandom(seed); return Array.from({ length: 30 }, () => selectAssignment(pool, { method: 'random', random })!.id); };
    expect(picks(42)).toEqual(picks(42));
    expect(new Set(picks(42))).toEqual(new Set(['a', 'b']));
    expect(picks(42)).not.toEqual(picks(43));
  });
  it.each(['balanced', 'priority', 'random'] as const)('%sでも1日の上限を先に除き、全員が上限なら選ばない', method => {
    const pool = [candidate('a', { dailyLimit: 1, dailyCount: 1 }), candidate('b')];
    expect(selectAssignment(pool, { method })?.id).toBe('b');
    expect(selectAssignment(pool.slice(0, 1), { method })).toBeNull();
  });
  it.each(['balanced', 'priority', 'random'] as const)('%sでも人数に合う最小卓が最優先', method => {
    const pool = [candidate('big', { minCapacity: 1, maxCapacity: 8 }), candidate('small', { minCapacity: 1, maxCapacity: 2, periodCount: 10, sortOrder: 10, priority: 'low' })];
    expect(selectAssignment(pool, { method, guestCount: 2, random: () => 0 })?.id).toBe('small');
    expect(selectAssignment(pool, { method, guestCount: 9 })).toBeNull();
  });
  it('結合卓のどれかが上限なら選ばず、無制限の卓は使える', () => {
    const pool = [candidate('joined', { members: [{ dailyCount: 2, dailyLimit: 2 }] }), candidate('single', { dailyCount: 100 })];
    expect(selectAssignment(pool, { method: 'balanced' })?.id).toBe('single');
    expect(pool[0].members).toHaveLength(1);
  });
  it('移行前は順番を保持する', () => {
    expect(selectAssignment([candidate('a', { periodCount: 10 }), candidate('b')], { method: 'legacy_first' })?.id).toBe('a');
  });
});
