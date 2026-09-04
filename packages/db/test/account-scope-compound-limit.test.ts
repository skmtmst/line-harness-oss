import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('account scope migrations stay below the D1 compound SELECT limit', () => {
  it.each(['199_common_var_account_scope.sql', '261_media_account_scope.sql'])(
    '%s has at most four terms per statement',
    (file) => {
      const sql = readFileSync(join(process.cwd(), 'migrations', file), 'utf8');
      // Remove SQL literals and comments before counting operators per statement.
      const statements = sql.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, '').split(';');
      expect(statements.some((statement) => /\bSELECT\b/i.test(statement))).toBe(true);
      for (const statement of statements) {
        const operators = statement.match(/\b(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/gi) ?? [];
        expect(operators.length, `${file}: ${statement.trim()}`).toBeLessThanOrEqual(3);
      }
    },
  );
});
