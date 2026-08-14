import { describe, expect, it } from 'vitest';
import type { DeployEnv, LockPayload } from './deploy-lock';
import {
  ENV_POLICY,
  PARENT_REPO_ENV_VAR,
  PRODUCTION_APPROVERS,
  type PreflightInput,
  evaluatePreflight,
  formatViolations,
  parseStatusPaths,
} from './preflight';

const HEAD = '6564955f9363ca00552a4e46eaf9fad3e07ca95c';

function lockFor(env: DeployEnv): LockPayload {
  return {
    env,
    holder: 'kentavndng',
    sha: HEAD,
    startedAt: '2026-08-14T02:00:00.000Z',
    note: '検証デプロイの安全ゲート',
  };
}

/**
 * A state where every gate passes for the given environment; each test
 * perturbs exactly one field.
 */
function passing(
  env: DeployEnv,
  overrides: Partial<PreflightInput> = {},
): PreflightInput {
  return {
    env,
    configPath: ENV_POLICY[env].config,
    remote: 'origin',
    branch: ENV_POLICY[env].branch,
    headSha: HEAD,
    remoteSha: HEAD,
    dirtyPaths: [],
    parentRepoPath: '/somewhere/nen-petfood-eccube',
    parentDirtyPaths: [],
    lock: lockFor(env),
    holder: 'kentavndng',
    approvedBy: env === 'production' ? 'skmtmst' : null,
    approvalRef:
      env === 'production'
        ? 'https://github.com/skmtmst/line-harness-oss/pull/14#issuecomment-1'
        : null,
    ...overrides,
  };
}

function codes(input: PreflightInput): string[] {
  const result = evaluatePreflight(input);
  return result.ok ? [] : result.violations.map((v) => v.code);
}

describe('ENV_POLICY', () => {
  it('validates from codex/development and ships production from main', () => {
    expect(ENV_POLICY.staging.branch).toBe('codex/development');
    expect(ENV_POLICY.production.branch).toBe('main');
  });

  it('pairs each environment with its own wrangler config', () => {
    expect(ENV_POLICY.staging.config).toBe('apps/worker/wrangler.staging.toml');
    expect(ENV_POLICY.production.config).toBe('apps/worker/wrangler.toml');
  });
});

describe('evaluatePreflight — 環境共通', () => {
  it('passes for staging when every gate is satisfied', () => {
    expect(evaluatePreflight(passing('staging'))).toEqual({ ok: true });
  });

  it('passes for production when every gate is satisfied', () => {
    expect(evaluatePreflight(passing('production'))).toEqual({ ok: true });
  });

  it.each(['staging', 'production'] as const)(
    'blocks an unclean LINE work tree (%s)',
    (env) => {
      expect(
        codes(passing(env, { dirtyPaths: ['apps/web/app/page.tsx'] })),
      ).toContain('dirty-worktree');
    },
  );

  it.each(['staging', 'production'] as const)(
    'blocks an unclean parent EC-CUBE work tree (%s)',
    (env) => {
      expect(
        codes(passing(env, { parentDirtyPaths: ['app/config/eccube/database.yaml'] })),
      ).toContain('parent-dirty-worktree');
    },
  );

  it('blocks when the parent repo was never specified', () => {
    const violations = codes(
      passing('staging', { parentRepoPath: null, parentDirtyPaths: null }),
    );
    expect(violations).toContain('parent-repo-unspecified');
    expect(violations).not.toContain('parent-repo-missing');
  });

  it('mentions the environment variable when the parent repo is unspecified', () => {
    const result = evaluatePreflight(
      passing('staging', { parentRepoPath: null, parentDirtyPaths: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const v = result.violations.find((x) => x.code === 'parent-repo-unspecified');
      expect(v?.message).toContain(PARENT_REPO_ENV_VAR);
    }
  });

  it('blocks when the specified parent repo is not readable', () => {
    const violations = codes(passing('staging', { parentDirtyPaths: null }));
    expect(violations).toContain('parent-repo-missing');
    expect(violations).not.toContain('parent-repo-unspecified');
  });

  it.each(['staging', 'production'] as const)(
    'blocks when the remote branch has moved (%s)',
    (env) => {
      expect(codes(passing(env, { remoteSha: 'a'.repeat(40) }))).toContain(
        'head-behind-remote',
      );
    },
  );

  it('names the configured remote in the mismatch message, not a hard-coded one', () => {
    const result = evaluatePreflight(
      passing('staging', { remote: 'fork', remoteSha: 'a'.repeat(40) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const v = result.violations.find((x) => x.code === 'head-behind-remote');
      expect(v?.message).toContain('fork/codex/development');
    }
  });
});

describe('evaluatePreflight — 基準ブランチは環境ごとに違う', () => {
  it('blocks staging deploys from main', () => {
    expect(codes(passing('staging', { branch: 'main' }))).toContain('wrong-branch');
  });

  it('blocks production deploys from codex/development', () => {
    expect(
      codes(passing('production', { branch: 'codex/development' })),
    ).toContain('wrong-branch');
  });

  it('blocks either environment when deploying from a feature branch', () => {
    expect(
      codes(passing('staging', { branch: 'codex/kenta-deploy-safety-gate' })),
    ).toContain('wrong-branch');
    expect(
      codes(passing('production', { branch: 'codex/kenta-deploy-safety-gate' })),
    ).toContain('wrong-branch');
  });

  it('tells production users to promote through main', () => {
    const result = evaluatePreflight(
      passing('production', { branch: 'codex/development' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const v = result.violations.find((x) => x.code === 'wrong-branch');
      expect(v?.message).toContain('main');
    }
  });
});

describe('evaluatePreflight — wrangler 設定の取り違え', () => {
  it('blocks the production config being used for staging', () => {
    expect(
      codes(passing('staging', { configPath: ENV_POLICY.production.config })),
    ).toContain('config-env-mismatch');
  });

  it('blocks the staging config being used for production', () => {
    expect(
      codes(passing('production', { configPath: ENV_POLICY.staging.config })),
    ).toContain('config-env-mismatch');
  });
});

describe('evaluatePreflight — 本番承認', () => {
  it('recognises only the owner GitHub login as an approver', () => {
    expect(PRODUCTION_APPROVERS).toEqual(['skmtmst']);
  });

  it('blocks production with no named approver', () => {
    expect(codes(passing('production', { approvedBy: null }))).toContain(
      'production-approval-missing',
    );
  });

  it('blocks production self-approved by the operator', () => {
    expect(codes(passing('production', { approvedBy: 'kentavndng' }))).toContain(
      'production-approval-invalid',
    );
  });

  it('rejects the display name "masato" now that logins are the only form', () => {
    expect(codes(passing('production', { approvedBy: 'masato' }))).toContain(
      'production-approval-invalid',
    );
  });

  it('accepts the approver login case-insensitively', () => {
    expect(
      evaluatePreflight(passing('production', { approvedBy: 'SKMTMST' })),
    ).toEqual({ ok: true });
  });

  it('blocks production without an approval record URL', () => {
    expect(codes(passing('production', { approvalRef: null }))).toContain(
      'production-approval-ref-missing',
    );
  });

  it('blocks production when the approval record is blank', () => {
    expect(codes(passing('production', { approvalRef: '   ' }))).toContain(
      'production-approval-ref-missing',
    );
  });

  it('states that --approved-by alone does not prove approval', () => {
    const result = evaluatePreflight(passing('production', { approvalRef: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const v = result.violations.find(
        (x) => x.code === 'production-approval-ref-missing',
      );
      expect(v?.message).toContain('承認の証明になりません');
    }
  });

  it('does not require approval fields for staging', () => {
    expect(
      evaluatePreflight(passing('staging', { approvedBy: null, approvalRef: null })),
    ).toEqual({ ok: true });
  });
});

describe('evaluatePreflight — デプロイロック', () => {
  it.each(['staging', 'production'] as const)(
    'blocks when no deploy lock is held (%s)',
    (env) => {
      expect(codes(passing(env, { lock: null }))).toContain('lock-not-held');
    },
  );

  it('blocks when the environment is locked by a collaborator', () => {
    expect(
      codes(passing('staging', { lock: { ...lockFor('staging'), holder: 'skmtmst' } })),
    ).toContain('lock-held-by-other');
  });

  it('blocks when the lock was declared for a different commit', () => {
    expect(
      codes(passing('staging', { lock: { ...lockFor('staging'), sha: 'b'.repeat(40) } })),
    ).toContain('lock-sha-mismatch');
  });
});

describe('evaluatePreflight — 集約', () => {
  it('reports every violation at once rather than stopping at the first', () => {
    const violations = codes(
      passing('staging', {
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
    const result = evaluatePreflight(passing('staging', { lock: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(formatViolations(result.violations)).toMatch(/^\[NG\] lock-not-held: /);
    }
  });
});
