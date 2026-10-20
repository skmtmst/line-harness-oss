import { sqlIdSet } from '@line-crm/db/id-queries';
import { type VisibleLineAccountScope } from '../../services/account-access.js';

export function accountClause(scope: VisibleLineAccountScope): { sql: string; binds: unknown[] } {
  if (scope.allowedAccountIds.length > 0) {
    return {
      sql: `(f.line_account_id IN (${sqlIdSet(scope.allowedAccountIds).sql})${scope.canSeeUnassigned ? ' OR f.line_account_id IS NULL' : ''})`,
      binds: scope.allowedAccountIds.length ? sqlIdSet(scope.allowedAccountIds).binds : [],
    };
  }
  return { sql: scope.canSeeUnassigned ? 'f.line_account_id IS NULL' : '1 = 0', binds: [] };
}
