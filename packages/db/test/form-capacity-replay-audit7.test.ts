import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { claimFormCapacitySlot, releaseFormCapacityClaims } from '../src/forms.js';
import { asD1 } from './d1-test-helper.js';

const opened: Database.Database[] = [];
afterEach(() => opened.splice(0).forEach((raw) => raw.close()));
function setup() {
  const raw = new Database(':memory:');
  opened.push(raw);
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.pragma('foreign_keys = ON');
  raw.exec("INSERT INTO forms (id, name) VALUES ('form', '質問'), ('other', '別フォーム')");
  return { raw, db: asD1(raw) };
}

describe('PKG18 capacity recovery before its checkpoint', () => {
  it.each([1, 2])('replays the exact reservation with limit %i without spending a second slot', async (limit) => {
    const { db, raw } = setup();
    expect(await claimFormCapacitySlot(db, 'form', 'option', 'same-answer', limit)).toBe(true);
    expect(await claimFormCapacitySlot(db, 'form', 'option', 'same-answer', limit)).toBe(true);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM form_capacity_claims').get()).toEqual({ n: 1 });
  });
  it('keeps the full-slot boundary and isolates form, option and answer identities', async () => {
    const { db, raw } = setup();
    expect(await claimFormCapacitySlot(db, 'form', 'option', 'answer-a', 1)).toBe(true);
    expect(await claimFormCapacitySlot(db, 'form', 'option', 'answer-b', 1)).toBe(false);
    expect(await claimFormCapacitySlot(db, 'form', 'other-option', 'answer-a', 1)).toBe(true);
    expect(await claimFormCapacitySlot(db, 'other', 'option', 'answer-a', 1)).toBe(true);
    await releaseFormCapacityClaims(db, 'form', 'answer-a');
    expect(await claimFormCapacitySlot(db, 'form', 'option', 'answer-b', 1)).toBe(true);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM form_capacity_claims WHERE form_id = 'other'").get()).toEqual({ n: 1 });
    expect(await claimFormCapacitySlot(db, 'form', 'zero', 'answer-c', 0)).toBe(false);
  });
});
