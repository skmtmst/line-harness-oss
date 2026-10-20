import type { BookingAssignmentMethod, BookingAssignmentPriority } from '@line-crm/shared';

export interface AssignmentCandidate {
  id: string;
  periodCount: number;
  dailyCount: number;
  dailyLimit: number | null;
  priority: BookingAssignmentPriority;
  sortOrder: number;
  /** 最後に予約を受けた時刻（未担当はnull）。 */
  lastAssignedAt?: string | null;
  minCapacity?: number;
  maxCapacity?: number;
  /** 結合卓は、構成卓のどれかが上限に達したら選ばない。 */
  members?: { dailyCount: number; dailyLimit: number | null }[];
}
const priorityRank = { preferred: 0, normal: 1, low: 2 } as const;

/** 空き・所属・勤務は呼出側で検査済み。人と卓で使う唯一の順位判定。 */
export function selectAssignment<T extends AssignmentCandidate>(
  candidates: readonly T[],
  options: { method: BookingAssignmentMethod | 'legacy_first'; guestCount?: number; random?: () => number },
): T | null {
  let pool = candidates.filter(c => (c.dailyLimit === null || c.dailyCount < c.dailyLimit)
    && (c.members ?? []).every(m => m.dailyLimit === null || m.dailyCount < m.dailyLimit)
    && (options.guestCount === undefined || (c.minCapacity !== undefined && c.maxCapacity !== undefined
      && c.minCapacity <= options.guestCount && options.guestCount <= c.maxCapacity)));
  if (options.method === 'legacy_first') return pool[0] ?? null;
  if (options.guestCount !== undefined && pool.length) {
    const smallest = Math.min(...pool.map(c => c.maxCapacity!));
    pool = pool.filter(c => c.maxCapacity === smallest);
  }
  const keepLowest = (score: (c: T) => number) => {
    if (!pool.length) return;
    const lowest = Math.min(...pool.map(score));
    pool = pool.filter(c => score(c) === lowest);
  };
  if (options.method === 'balanced') keepLowest(c => c.periodCount);
  if (options.method === 'priority') keepLowest(c => c.sortOrder);
  if (options.method !== 'random') {
    keepLowest(c => priorityRank[c.priority]);
    keepLowest(c => c.lastAssignedAt ? Date.parse(c.lastAssignedAt) : -Infinity);
  }
  if (!pool.length) return null;
  const value = (options.random ?? Math.random)();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('invalid_assignment_random');
  return pool[Math.floor(value * pool.length)]!;
}

/** 試験用の乱数源。公開APIから種は受け取らない。 */
export function seededAssignmentRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
