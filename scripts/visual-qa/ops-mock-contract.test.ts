/*
 * 運営コンソール（`/ops/*`）の画面確認モックが本物と約束違いしていないかの試験。
 *
 * 偽APIに運営メンバーの判定（`platformAdmin`）が無いと、`/ops` の全ページが
 * ログイン画面になり、撮影が「ログイン画面を撮って通過」になる。
 * 各ページが読む口の見本データも、本物（Worker の `ops*.ts`）の器に合わせる。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_API = readFileSync(join(HERE, 'mock-api.mjs'), 'utf8');

describe('運営コンソールの画面確認モック', () => {
  it('セッションを運営メンバーとして返す', () => {
    expect(MOCK_API).toContain('platformAdmin: true');
  });

  it('各ページが読む口を持つ', () => {
    for (const path of [
      "'/api/ops/me'",
      "'/api/ops/tenants'",
      "'/api/ops/impersonation/current'",
      "'/api/ops/dashboard'",
      "'/api/ops/dashboard/line-unregistered'",
      "'/api/ops/support/summary'",
      "'/api/ops/support/tickets'",
      "'/api/ops/knowledge'",
      "'/api/ops/announcements'",
      "'/api/ops/notice-line-account'",
      "'/api/ops/audit'",
      "'/api/ops/members'",
    ]) {
      expect(MOCK_API, `mock に ${path} がない`).toContain(path);
    }
  });

  it('見本データに実在しそうな個人情報を入れない', () => {
    // 運営の見本データ（`OPS_*`）の範囲だけ見る。後ろの既存の器に
    // 昔ながらの `example.com` が残っているが、この試験の対象外。
    const opsBlock = MOCK_API.slice(MOCK_API.indexOf('const OPS_ME'), MOCK_API.indexOf('機能9'));
    expect(opsBlock.length).toBeGreaterThan(0);
    expect(opsBlock).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  });
});
