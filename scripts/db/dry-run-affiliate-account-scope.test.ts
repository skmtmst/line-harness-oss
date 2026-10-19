import { describe, expect, it } from 'vitest';
import {
  AFFILIATE_ACCOUNT_SCOPE_DRY_RUN_QUERY,
  summarizeAffiliateAccountScope,
} from './dry-run-affiliate-account-scope';

describe('紹介者のアカウント帰属dry-run', () => {
  it('一意・候補なし・競合を分け、人の確認対象を残す', () => {
    const report = summarizeAffiliateAccountScope([
      { affiliate_id: 'a', candidate_account_count: 1, candidate_account_ids: 'account-a' },
      { affiliate_id: 'b', candidate_account_count: 0, candidate_account_ids: null },
      { affiliate_id: 'c', candidate_account_count: 2, candidate_account_ids: 'account-a,account-b' },
    ]);
    expect(report).toMatchObject({ total: 3, assignable: 1, unassigned: 1, conflicting: 1 });
    expect(report.needsReview.map((row) => row.affiliate_id)).toEqual(['b', 'c']);
  });

  it('remote queryは読み取り専用である', () => {
    expect(AFFILIATE_ACCOUNT_SCOPE_DRY_RUN_QUERY).toMatch(/^\s*WITH\s/i);
    expect(AFFILIATE_ACCOUNT_SCOPE_DRY_RUN_QUERY).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|ALTER|DROP)\b/i);
  });
});
