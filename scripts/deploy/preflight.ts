#!/usr/bin/env tsx
/**
 * Deploy preflight gate.
 *
 * Encodes the AGENTS.md gates that are easy to skip by hand when two people
 * share one validation stack:
 *
 *   - both work trees clean (this repo AND the parent EC-CUBE repo)
 *   - deploying only from the base branch that belongs to the environment
 *   - local HEAD identical to that branch on the deploy remote
 *   - the wrangler config matches the environment being deployed
 *   - production additionally requires a named approver and an approval record
 *   - the deploy lock for this environment is held by the operator
 *
 * Base branches differ per environment on purpose. `codex/development` is the
 * development/validation integration branch; `main` is the version already
 * validated and approved for production. Requiring `codex/development` for a
 * production deploy would ship unvalidated work, and requiring `main` for a
 * staging deploy would make validation impossible.
 *
 * Nothing machine-specific is baked in: the parent repository path and the
 * deploy remote both come from flags or environment variables, because the
 * checkout location differs per developer and forks use different remote
 * names. A value that cannot be confirmed is a stop, not a default.
 *
 * `evaluatePreflight` is pure so every rule is unit-tested without touching
 * git, wrangler, or Cloudflare. The CLI collects the real state and feeds it in.
 *
 * CLI:
 *   tsx scripts/deploy/preflight.ts <staging|production>
 *       [--config <path>] [--remote <name>] [--parent-repo <path>]
 *       [--approved-by <github-login>] [--approval-ref <url>]
 *
 * Exit code 0 = all gates pass, 1 = at least one violation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, env as processEnv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  type DeployEnv,
  type GitEnv,
  type LockPayload,
  isDeployEnv,
  lockRef,
  parseLockPayload,
  resolveRemote,
} from './deploy-lock';

/** Base branch and wrangler config that belong to each environment. */
export const ENV_POLICY: Record<DeployEnv, { branch: string; config: string }> = {
  staging: {
    branch: 'codex/development',
    config: 'apps/worker/wrangler.staging.toml',
  },
  production: {
    branch: 'main',
    config: 'apps/worker/wrangler.toml',
  },
};

/**
 * GitHub logins allowed to authorise a production deploy.
 *
 * This is a guard rail, not proof: `--approved-by` is typed by whoever runs
 * the command, so it cannot by itself demonstrate that the owner approved
 * anything. The actual approval record lives in the PR (see --approval-ref
 * and docs/DEPLOY-GATE.md).
 */
export const PRODUCTION_APPROVERS: readonly string[] = ['skmtmst'];

/** Environment variable consulted when `--parent-repo` is not passed. */
export const PARENT_REPO_ENV_VAR = 'LINE_HARNESS_PARENT_REPO';

export interface PreflightInput {
  env: DeployEnv;
  /** Wrangler config the caller intends to pass to `wrangler deploy`. */
  configPath: string;
  /** Deploy remote name, already verified to exist. */
  remote: string;
  /** Current branch of this repo. */
  branch: string;
  /** Local HEAD sha. */
  headSha: string;
  /** `<remote>/<base branch>` sha, freshly fetched. */
  remoteSha: string;
  /** `git status --porcelain` paths in this repo (empty = clean). */
  dirtyPaths: string[];
  /** Resolved parent EC-CUBE repository path; null when not specified. */
  parentRepoPath: string | null;
  /** Dirty paths in the parent repo; null when the path is not a usable repo. */
  parentDirtyPaths: string[] | null;
  /** Current remote lock for this environment, or null when unlocked. */
  lock: LockPayload | null;
  /** GitHub login of the operator. */
  holder: string;
  /** `--approved-by` value for production deploys. */
  approvedBy: string | null;
  /** `--approval-ref` URL pointing at the approval record. */
  approvalRef: string | null;
}

export interface Violation {
  /** Stable identifier for tests and for grepping runbooks. */
  code: string;
  /** Operator-facing explanation, including the fix. */
  message: string;
}

export type PreflightResult =
  | { ok: true }
  | { ok: false; violations: Violation[] };

export function evaluatePreflight(input: PreflightInput): PreflightResult {
  const violations: Violation[] = [];
  const policy = ENV_POLICY[input.env];

  if (input.dirtyPaths.length > 0) {
    violations.push({
      code: 'dirty-worktree',
      message:
        'LINE リポジトリに未コミットの変更または未追跡ファイルがあります。' +
        `内容を確認してコミットするか .gitignore に追加してください: ${input.dirtyPaths.join(', ')}`,
    });
  }

  if (input.parentRepoPath === null) {
    violations.push({
      code: 'parent-repo-unspecified',
      message:
        '親の EC-CUBE リポジトリが指定されていません。' +
        `--parent-repo または ${PARENT_REPO_ENV_VAR} で指定してください。` +
        'PC ごとに配置が違うため、既定値は持ちません。',
    });
  } else if (input.parentDirtyPaths === null) {
    violations.push({
      code: 'parent-repo-missing',
      message:
        `親の EC-CUBE リポジトリを ${input.parentRepoPath} で確認できませんでした。` +
        'パスが正しいか、git リポジトリかを確認してください。',
    });
  } else if (input.parentDirtyPaths.length > 0) {
    violations.push({
      code: 'parent-dirty-worktree',
      message:
        '親の EC-CUBE リポジトリに未コミットの変更があります。' +
        `LINE 側とは別に整理してください: ${input.parentDirtyPaths.join(', ')}`,
    });
  }

  if (input.branch !== policy.branch) {
    violations.push({
      code: 'wrong-branch',
      message:
        `${input.env} のデプロイは ${policy.branch} からのみ行えます（現在: ${input.branch}）。` +
        (input.env === 'production'
          ? '検証に合格した内容を main へ反映してから実行してください。'
          : 'PR を統合してから、統合済みのコミットをデプロイしてください。'),
    });
  }

  if (input.headSha !== input.remoteSha) {
    violations.push({
      code: 'head-behind-remote',
      message:
        `ローカル HEAD (${input.headSha.slice(0, 7)}) が ` +
        `${input.remote}/${policy.branch} (${input.remoteSha.slice(0, 7)}) と一致しません。` +
        '共同開発者の更新が入っている可能性があります。取り込んでテストをやり直してください。',
    });
  }

  if (input.configPath !== policy.config) {
    violations.push({
      code: 'config-env-mismatch',
      message:
        `${input.env} には ${policy.config} を指定してください（指定値: ${input.configPath}）。` +
        '設定ファイルの取り違えは、検証のつもりで本番へ配備する事故に直結します。',
    });
  }

  if (input.env === 'production') {
    const approver = input.approvedBy?.trim().toLowerCase() ?? '';
    if (!approver) {
      violations.push({
        code: 'production-approval-missing',
        message:
          '本番デプロイには --approved-by <GitHubログイン> が必要です。' +
          'Cloudflare の権限があること自体は承認ではありません。',
      });
    } else if (!PRODUCTION_APPROVERS.includes(approver)) {
      violations.push({
        code: 'production-approval-invalid',
        message:
          `${input.approvedBy} は本番デプロイの承認者ではありません` +
          `（承認できるのは ${PRODUCTION_APPROVERS.join(' / ')}）。`,
      });
    }
    if (!input.approvalRef?.trim()) {
      violations.push({
        code: 'production-approval-ref-missing',
        message:
          '本番デプロイには --approval-ref で承認記録の URL が必要です。' +
          '--approved-by は実行者が自分で入力できるため、それ単独では承認の証明になりません。' +
          'PR コメントなど、承認が残っている場所を指定してください。',
      });
    }
  }

  if (input.lock === null) {
    violations.push({
      code: 'lock-not-held',
      message:
        `${input.env} のデプロイロックを取得していません。` +
        `先に \`pnpm deploy:lock acquire ${input.env} --note "変更範囲"\` を実行してください。`,
    });
  } else if (input.lock.holder !== input.holder) {
    violations.push({
      code: 'lock-held-by-other',
      message:
        `${input.env} は ${input.lock.holder} さんが使用中です（${input.lock.note}）。` +
        '終了の連絡を待ってから実行してください。',
    });
  } else if (input.lock.sha !== input.headSha) {
    violations.push({
      code: 'lock-sha-mismatch',
      message:
        `ロック取得時のコミット (${input.lock.sha.slice(0, 7)}) と ` +
        `デプロイ対象 (${input.headSha.slice(0, 7)}) が違います。` +
        'ロックを取り直して、宣言した対象コミットを揃えてください。',
    });
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `[NG] ${v.code}: ${v.message}`).join('\n');
}

/**
 * Extract paths from `git status --porcelain` output.
 *
 * Each line is `XY<space>PATH`, where X/Y may be a space (` M` = modified but
 * unstaged). The leading space must not be trimmed away, or the first entry
 * loses a character — which silently turns `.github/...` into `github/...`.
 * Parsing is separated from the git call so that stays covered by tests.
 */
export function parseStatusPaths(raw: string): string[] {
  return raw
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());
}

// ---------------------------------------------------------------------------
// state collection (side-effecting)
// ---------------------------------------------------------------------------

function git(args: string[], cwd?: string): string {
  // Piped stderr: see deploy-lock.ts — git's own output would bury the
  // violation list we are about to print.
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function dirtyPaths(cwd?: string): string[] {
  // Deliberately untrimmed — see parseStatusPaths.
  const out = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return parseStatusPaths(out);
}

function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function readRemoteLock(env: DeployEnv, gitEnv: GitEnv): LockPayload | null {
  const ref = lockRef(env);
  const ls = git(['ls-remote', gitEnv.remote, ref]);
  if (!ls) return null;
  const sha = ls.split(/\s+/)[0];
  git(['fetch', '--quiet', gitEnv.remote, `+${ref}:${ref}`]);
  return parseLockPayload(git(['show', `${sha}:lock.json`]));
}

function currentHolder(): string {
  return execFileSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** A path only counts as the parent repo when git can actually read it. */
function readParentDirtyPaths(path: string): string[] | null {
  if (!existsSync(path)) return null;
  try {
    return dirtyPaths(path);
  } catch {
    return null;
  }
}

function main(): void {
  const args = argv.slice(2);
  const envArg = args[0];
  if (!envArg || !isDeployEnv(envArg)) {
    stderr.write(
      '使い方: tsx scripts/deploy/preflight.ts <staging|production> ' +
        '[--config <path>] [--remote <name>] [--parent-repo <path>] ' +
        '[--approved-by <github-login>] [--approval-ref <url>]\n',
    );
    exit(1);
  }
  const env = envArg;
  const policy = ENV_POLICY[env];
  const gitEnv: GitEnv = { remote: resolveRemote(readFlag(args, '--remote')) };
  const parentRepoPath =
    readFlag(args, '--parent-repo') ?? processEnv[PARENT_REPO_ENV_VAR] ?? null;

  // Fetch first: the whole point of the gate is comparing against the
  // *current* remote branch, not a stale local ref.
  git(['fetch', '--quiet', gitEnv.remote, policy.branch]);

  const input: PreflightInput = {
    env,
    configPath: readFlag(args, '--config') ?? policy.config,
    remote: gitEnv.remote,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    headSha: git(['rev-parse', 'HEAD']),
    remoteSha: git(['rev-parse', 'FETCH_HEAD']),
    dirtyPaths: dirtyPaths(),
    parentRepoPath,
    parentDirtyPaths: parentRepoPath ? readParentDirtyPaths(parentRepoPath) : null,
    lock: readRemoteLock(env, gitEnv),
    holder: currentHolder(),
    approvedBy: readFlag(args, '--approved-by') ?? null,
    approvalRef: readFlag(args, '--approval-ref') ?? null,
  };

  const result = evaluatePreflight(input);
  if (!result.ok) {
    stderr.write(`${formatViolations(result.violations)}\n`);
    stderr.write(`\n${result.violations.length} 件の問題があります。デプロイを中止します。\n`);
    exit(1);
  }
  stdout.write(
    `OK — ${env} の事前確認をすべて通過しました` +
      `（${policy.branch} @ ${input.headSha.slice(0, 7)} / remote: ${input.remote}）。\n`,
  );
}

// See deploy-lock.ts: the checkout path contains spaces, so compare via
// pathToFileURL rather than interpolating the raw path into a file:// string.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    main();
  } catch (err) {
    stderr.write(`${(err as Error).message}\n`);
    exit(1);
  }
}
