import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  advanceFriendScenario,
  getFriendScenariosDueForDelivery,
} from '../src/scenarios.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(query).run(...params);
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() {
      return (sqlite.prepare(query).get(...params) as T) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
    },
  });
  return {
    prepare(query: string) {
      return { bind: (...params: unknown[]) => wrap(query, params), ...wrap(query, []) };
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
  sqlite.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active) VALUES (?, ?, 'manual', ?)`,
  ).run('active-scenario', 'active', 1);
  sqlite.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active) VALUES (?, ?, 'manual', ?)`,
  ).run('inactive-scenario', 'inactive', 0);
});

function insertEnrollment(
  id: string,
  scenarioId: string,
  status: 'active' | 'paused',
  nextDeliveryAt: string,
): void {
  sqlite.prepare(
    `INSERT INTO friends (id, line_user_id, created_at, updated_at)
     VALUES (?, ?, '2026-09-03', '2026-09-03')`,
  ).run(`friend-${id}`, `U-${id}`);
  sqlite.prepare(
    `INSERT INTO friend_scenarios
       (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
     VALUES (?, ?, ?, -1, ?, '2026-09-03T08:00:00.000+09:00', ?, '2026-09-03T08:00:00.000+09:00')`,
  ).run(id, `friend-${id}`, scenarioId, status, nextDeliveryAt);
}

describe('getFriendScenariosDueForDelivery', () => {
  test('migration converts legacy Z values and adds the due-delivery index', () => {
    insertEnrollment('legacy-z', 'active-scenario', 'active', '2026-09-03T00:30:00.000Z');
    insertEnrollment('canonical', 'active-scenario', 'active', '2026-09-03T09:45:00.000+09:00');

    sqlite.exec(
      readFileSync(
        join(PKG_ROOT, 'migrations', '267_scenario_delivery_timestamp_normalization.sql'),
        'utf8',
      ),
    );

    const rows = sqlite.prepare(
      `SELECT id, next_delivery_at FROM friend_scenarios
       WHERE id IN ('legacy-z', 'canonical') ORDER BY id`,
    ).all() as Array<{ id: string; next_delivery_at: string }>;
    expect(rows).toEqual([
      { id: 'canonical', next_delivery_at: '2026-09-03T09:45:00.000+09:00' },
      { id: 'legacy-z', next_delivery_at: '2026-09-03T09:30:00.000+09:00' },
    ]);
    expect(
      sqlite.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_friend_scenarios_due_delivery'`,
      ).get(),
    ).toEqual({ name: 'idx_friend_scenarios_due_delivery' });
  });

  test('returns only due active rows in timestamp order and applies the batch limit', async () => {
    for (let i = 0; i < 45; i++) {
      insertEnrollment(
        `due-${String(i).padStart(2, '0')}`,
        'active-scenario',
        'active',
        `2026-09-03T08:${String(i).padStart(2, '0')}:00.000+09:00`,
      );
    }
    insertEnrollment('future', 'active-scenario', 'active', '2026-09-03T10:00:00.000+09:00');
    insertEnrollment('paused', 'active-scenario', 'paused', '2026-09-03T08:00:00.000+09:00');
    insertEnrollment('disabled', 'inactive-scenario', 'active', '2026-09-03T08:00:00.000+09:00');

    const rows = await getFriendScenariosDueForDelivery(
      db,
      '2026-09-03T09:00:00.000+09:00',
      40,
    );

    expect(rows).toHaveLength(40);
    expect(rows[0].id).toBe('due-00');
    expect(rows.at(-1)?.id).toBe('due-39');
  });

  test('isolates a synthetic scenario for the staging batch check', async () => {
    sqlite.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active) VALUES (?, ?, 'manual', 1)`,
    ).run('verification-scenario', 'verification');
    for (let i = 0; i < 41; i++) {
      insertEnrollment(
        `verification-${String(i).padStart(2, '0')}`,
        'verification-scenario',
        'active',
        '2026-09-03T08:00:00.000+09:00',
      );
    }
    insertEnrollment('unrelated', 'active-scenario', 'active', '2026-09-03T08:00:00.000+09:00');

    const first = await getFriendScenariosDueForDelivery(
      db,
      '2026-09-03T09:00:00.000+09:00',
      40,
      'verification-scenario',
    );
    expect(first).toHaveLength(40);
    expect(first.every((row) => row.scenario_id === 'verification-scenario')).toBe(true);

    const placeholders = first.map(() => '?').join(', ');
    sqlite.prepare(
      `UPDATE friend_scenarios SET status = 'completed' WHERE id IN (${placeholders})`,
    ).run(...first.map((row) => row.id));
    const second = await getFriendScenariosDueForDelivery(
      db,
      '2026-09-03T09:00:00.000+09:00',
      40,
      'verification-scenario',
    );
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('verification-40');
  });

  test('normalizes a next timestamp before saving it', async () => {
    insertEnrollment('advance', 'active-scenario', 'active', '2026-09-03T08:00:00.000+09:00');

    await advanceFriendScenario(db, 'advance', 1, '2026-09-03T00:30:00.000Z');

    const row = sqlite.prepare(
      `SELECT next_delivery_at FROM friend_scenarios WHERE id = 'advance'`,
    ).get() as { next_delivery_at: string };
    expect(row.next_delivery_at).toBe('2026-09-03T09:30:00.000+09:00');
  });
});
