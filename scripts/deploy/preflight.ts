#!/usr/bin/env tsx
/**
 * Deploy preflight gate.
 *
 * Encodes the AGENTS.md gates that are easy to skip by hand when two people
 * share one validation stack:
 *
 *   - both work trees clean (this repo AND the parent EC-CUBE repo)
 *   - deploying only what is already integrated into `codex/development`
 *   - local HEAD identical to `origin/codex/development`
 *   - the wrangler config matches the environment being deployed
 *   - production requires an explicit named approval (Masato)
 *   - the deploy lock for this environment is held by the operator
 *
 * `evaluatePreflight` is pure so every rule is unit-tested without touching
 * git, wrangler, or Cloudflare. The CLI collects the real state and feeds it in.
 *
 * CLI:
 *   tsx scripts/deploy/preflight.ts <staging|production> [--config <path>]
 *                                   [--parent-repo <path>] [--approved-by <name>]
 *
 * Exit code 0 = all gates pass, 1 = at least one violation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  type DeployEnv,
  type LockPayload,
  isDeployEnv,
  lockRef,
  parseLockPayload,
} from './deploy-lock';

/** The only branch a deploy may ship from. */
export const INTEGRATION_BRANCH = 'codex/development';

/** Wrangler config required for each environment. */
export const CONFIG_BY_ENV: Record<DeployEnv, string> = {
  staging: 'apps/worker/wrangler.staging.toml',
  production: 'apps/worker/wrangler.toml',
};

/** Who may authorise a production deploy. Owner-only per the agreed rules. */
export const PRODUCTION_APPROVERS: readonly string[] = ['masato', 'skmtmst'];

export interface PreflightInput {
  env: DeployEnv;
  /** Wrangler config the caller intends to pass to `wrangler deploy`. */
  configPath: string;
  /** Current branch of this repo. */
  branch: string;
  /** Local HEAD sha. */
  headSha: string;
  /** `origin/codex/development` sha, freshly fetched. */
  remoteSha: string;
  /** `git status --short` paths in this repo (empty = clean). */
  dirtyPaths: string[];
  /** Same for the parent EC-CUBE repo; null when the repo was not found. */
  parentDirtyPaths: string[] | null;
  /** Current remote lock for this environment, or null when unlocked. */
  lock: LockPayload | null;
  /** GitHub login of the operator. */
  holder: string;
  /** `--approved-by` value for production deploys. */
  approvedBy: string | null;
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

  if (input.dirtyPaths.length > 0) {
    violations.push({
      code: 'dirty-worktree',
      message:
        'LINE リポジトリに未コミットの変更または未追跡ファイルがあります。' +
        `内容を確認してコミットするか .gitignore に追加してください: ${input.dirtyPaths.join(', ')}`,
    });
  }

  if (input.parentDirtyPaths === null) {
    violations.push({
      code: 'parent-repo-missing',
      message:
        '親の EC-CUBE リポジトリを確認できませんでした。--parent-repo でパスを指定してください。',
    });
  } else if (input.parentDirtyPaths.length > 0) {
    violations.push({
      code: 'parent-dirty-worktree',
      message:
        '親の EC-CUBE リポジトリに未コミットの変更があります。' +
        `LINE 側とは別に整理してください: ${input.parentDirtyPaths.join(', ')}`,
    });
  }

  if (input.branch !== INTEGRATION_BRANCH) {
    violations.push({
      code: 'wrong-branch',
      message:
        `デプロイは ${INTEGRATION_BRANCH} からのみ行えます（現在: ${input.branch}）。` +
        'PR を統合してから、統合済みのコミットをデプロイしてください。',
    });
  }

  if (input.headSha !== input.remoteSha) {
    violations.push({
      code: 'head-behind-remote',
      message:
        `ローカル HEAD (${input.headSha.slice(0, 7)}) が ` +
        `origin/${INTEGRATION_BRANCH} (${input.remoteSha.slice(0, 7)}) と一致しません。` +
        '共同開発者の更新が入っている可能性があります。取り込んでテストをやり直してください。',
    });
  }

  const expectedConfig = CONFIG_BY_ENV[input.env];
  if (input.configPath !== expectedConfig) {
    violations.push({
      code: 'config-env-mismatch',
      message:
        `${input.env} には ${expectedConfig} を指定してください（指定値: ${input.configPath}）。` +
        '設定ファイルの取り違えは、検証のつもりで本番へ配備する事故に直結します。',
    });
  }

  if (input.env === 'production') {
    const approver = input.approvedBy?.trim().toLowerCase() ?? '';
    if (!approver) {
      violations.push({
        code: 'production-approval-missing',
        message:
          '本番デプロイには Masato さんの明示的な承認と担当指定が必要です。' +
          '--approved-by <承認者> を付けてください。Cloudflare の権限があること自体は承認ではありません。',
      });
    } else if (!PRODUCTION_APPROVERS.includes(approver)) {
      violations.push({
        code: 'production-approval-invalid',
        message:
          `${input.approvedBy} は本番デプロイの承認者ではありません` +
          `（承認できるのは ${PRODUCTION_APPROVERS.join(' / ')}）。`,
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
  });
  return parseStatusPaths(out);
}

function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function readRemoteLock(env: DeployEnv): LockPayload | null {
  const ref = lockRef(env);
  const ls = git(['ls-remote', 'origin', ref]);
  if (!ls) return null;
  const sha = ls.split(/\s+/)[0];
  git(['fetch', '--quiet', 'origin', `+${ref}:${ref}`]);
  return parseLockPayload(git(['show', `${sha}:lock.json`]));
}

function currentHolder(): string {
  return execFileSync('gh', ['api', 'user', '--jq', '.login'], {
    encoding: 'utf8',
  }).trim();
}

function main(): void {
  const args = argv.slice(2);
  const envArg = args[0];
  if (!envArg || !isDeployEnv(envArg)) {
    stderr.write(
      '使い方: tsx scripts/deploy/preflight.ts <staging|production> ' +
        '[--config <path>] [--parent-repo <path>] [--approved-by <name>]\n',
    );
    exit(1);
  }
  const env = envArg;
  const parentRepo =
    readFlag(args, '--parent-repo') ??
    '/Volumes/My Passport/Github/nen-petfood-eccube';

  // Fetch first: the whole point of the gate is comparing against the
  // *current* remote, not a stale local ref.
  git(['fetch', '--quiet', 'origin', INTEGRATION_BRANCH]);

  const input: PreflightInput = {
    env,
    configPath: readFlag(args, '--config') ?? CONFIG_BY_ENV[env],
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    headSha: git(['rev-parse', 'HEAD']),
    remoteSha: git(['rev-parse', `origin/${INTEGRATION_BRANCH}`]),
    dirtyPaths: dirtyPaths(),
    parentDirtyPaths: existsSync(parentRepo) ? dirtyPaths(parentRepo) : null,
    lock: readRemoteLock(env),
    holder: currentHolder(),
    approvedBy: readFlag(args, '--approved-by') ?? null,
  };

  const result = evaluatePreflight(input);
  if (!result.ok) {
    stderr.write(`${formatViolations(result.violations)}\n`);
    stderr.write(`\n${result.violations.length} 件の問題があります。デプロイを中止します。\n`);
    exit(1);
  }
  stdout.write(
    `OK — ${env} の事前確認をすべて通過しました（${input.headSha.slice(0, 7)}）。\n`,
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
