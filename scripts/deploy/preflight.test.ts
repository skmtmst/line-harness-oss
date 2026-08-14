import { describe, expect, it } from 'vitest';
import type { LockPayload } from './deploy-lock';
import {
  CONFIG_BY_ENV,
  INTEGRATION_BRANCH,
  type PreflightInput,
  evaluatePreflight,
  formatViolations,
  parseStatusPaths,
} from './preflight';

const HEAD = '6564955f9363ca00552a4e46eaf9fad3e07ca95c';

const heldLock: LockPayload = {
  env: 'staging',
  holder: 'kentavndng',
  sha: HEAD,
  startedAt: '2026-08-14T02:00:00.000Z',
  note: '検証デプロイの安全ゲート',
};

/** A state where every gate passes; each test perturbs exactly one field. */
function passing(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    env: 'staging',
    configPath: CONFIG_BY_ENV.staging,
    branch: INTEGRATION_BRANCH,
    headSha: HEAD,
    remoteSha: HEAD,
    dirtyPaths: [],
    parentDirtyPaths: [],
    lock: heldLock,
    holder: 'kentavndng',
    approvedBy: null,
    ...overrides,
  };
}

function codes(input: PreflightInput): string[] {
  const result = evaluatePreflight(input);
  return result.ok ? [] : result.violations.map((v) => v.code);
}

describe('evaluatePreflight', () => {
  it('passes when every gate is satisfied', () => {
    expect(evaluatePreflight(passing())).toEqual({ ok: true });
  });

  it('blocks an unclean LINE work tree', () => {
    expect(codes(passing({ dirtyPaths: ['apps/web/app/page.tsx'] }))).toContain(
      'dirty-worktree',
    );
  });

  it('blocks an unclean parent EC-CUBE work tree', () => {
    expect(
      codes(passing({ parentDirtyPaths: ['app/config/eccube/database.yaml'] })),
    ).toContain('parent-dirty-worktree');
  });

  it('blocks when the parent repo could not be checked at all', () => {
    expect(codes(passing({ parentDirtyPaths: null }))).toContain(
      'parent-repo-missing',
    );
  });

  it('blocks deploying from a feature branch', () => {
    expect(codes(passing({ branch: 'codex/kenta-deploy-safety-gate' }))).toContain(
      'wrong-branch',
    );
  });

  it('blocks when a collaborator has moved the integration branch', () => {
    expect(codes(passing({ remoteSha: 'a'.repeat(40) }))).toContain(
      'head-behind-remote',
    );
  });

  it('blocks the production config being used for a staging deploy', () => {
    expect(codes(passing({ configPath: CONFIG_BY_ENV.production }))).toContain(
      'config-env-mismatch',
    );
  });

  it('blocks the staging config being used for a production deploy', () => {
    const violations = codes(
      passing({
        env: 'production',
        configPath: CONFIG_BY_ENV.staging,
        approvedBy: 'masato',
        lock: { ...heldLock, env: 'production' },
      }),
    );
    expect(violations).toContain('config-env-mismatch');
  });

  it('blocks a production deploy with no named approver', () => {
    expect(
      codes(
        passing({
          env: 'production',
          configPath: CONFIG_BY_ENV.production,
          lock: { ...heldLock, env: 'production' },
        }),
      ),
    ).toContain('production-approval-missing');
  });

  it('blocks a production deploy self-approved by the operator', () => {
    expect(
      codes(
        passing({
          env: 'production',
          configPath: CONFIG_BY_ENV.production,
          approvedBy: 'kentavndng',
          lock: { ...heldLock, env: 'production' },
        }),
      ),
    ).toContain('production-approval-invalid');
  });

  it('allows a production deploy approved by the owner', () => {
    expect(
      evaluatePreflight(
        passing({
          env: 'production',
          configPath: CONFIG_BY_ENV.production,
          approvedBy: 'Masato',
          lock: { ...heldLock, env: 'production' },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('blocks when no deploy lock is held', () => {
    expect(codes(passing({ lock: null }))).toContain('lock-not-held');
  });

  it('blocks when the environment is locked by a collaborator', () => {
    expect(
      codes(passing({ lock: { ...heldLock, holder: 'skmtmst' } })),
    ).toContain('lock-held-by-other');
  });

  it('blocks when the lock was declared for a different commit', () => {
    expect(codes(passing({ lock: { ...heldLock, sha: 'b'.repeat(40) } }))).toContain(
      'lock-sha-mismatch',
    );
  });

  it('reports every violation at once rather than stopping at the first', () => {
    const violations = codes(
      passing({
        dirtyPaths: ['apps/web/app/page.tsx'],
        branch: 'codex/kenta-wip',
        lock: null,
      }),
    );
    expect(violations).toEqual(
      expect.arrayContaining(['dirty-worktree', 'wrong-branch', 'lock-not-held']),
    );
  });
});

describe('parseStatusPaths', () => {
  it('keeps a leading dot on the first entry (unstaged status starts with a space)', () => {
    const raw = ' M .github/workflows/update-from-upstream.yml\n M docs/DEPLOY-GATE.md\n';
    expect(parseStatusPaths(raw)).toEqual([
      '.github/workflows/update-from-upstream.yml',
      'docs/DEPLOY-GATE.md',
    ]);
  });

  it('handles staged, untracked and mixed status codes', () => {
    const raw = 'M  package.json\n?? scripts/deploy/\nMM apps/web/app/page.tsx\n';
    expect(parseStatusPaths(raw)).toEqual([
      'package.json',
      'scripts/deploy/',
      'apps/web/app/page.tsx',
    ]);
  });

  it('returns nothing for a clean tree', () => {
    expect(parseStatusPaths('')).toEqual([]);
    expect(parseStatusPaths('\n')).toEqual([]);
  });
});

describe('formatViolations', () => {
  it('prefixes each line with [NG] and the stable code', () => {
    const result = evaluatePreflight(passing({ lock: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(formatViolations(result.violations)).toMatch(/^\[NG\] lock-not-held: /);
    }
  });
});
