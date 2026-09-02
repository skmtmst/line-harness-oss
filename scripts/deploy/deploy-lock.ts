#!/usr/bin/env tsx
/**
 * Distributed deploy lock backed by a git ref on the deploy remote.
 *
 * Why a git ref: the validation stack (Worker `nen-line-stg`, D1, R2, Pages,
 * and the test LINE channel) exists exactly once, so two developers deploying
 * at the same time silently invalidate each other's verification. We need
 * mutual exclusion that every developer can see, but we do not want to add
 * infrastructure. A ref under `refs/deploy-locks/<env>` gives us that for
 * free: `git push` of a fresh orphan commit into an already-occupied ref is
 * rejected as non-fast-forward by the server, so "who got the lock" is decided
 * atomically by the server rather than by a check-then-act race on the client.
 *
 * Release is guarded the same way. Deleting the ref unconditionally would let
 * a slow release wipe out a lock somebody else acquired in the meantime, so
 * the delete carries the SHA we read via `--force-with-lease=<ref>:<sha>` and
 * the server refuses it if the ref has moved.
 *
 * The lock never touches the working tree: the payload is written with git
 * plumbing (hash-object / mktree / commit-tree), so acquiring a lock cannot
 * violate the clean-worktree gate in AGENTS.md.
 *
 * The remote is never hard-coded: forks use different remote names (`origin`
 * here, `fork` on other machines), so it comes from `--remote`, then
 * `LINE_HARNESS_DEPLOY_REMOTE`, then `origin` — and is verified to exist
 * before any push. An unverifiable remote is a stop, not a guess.
 *
 * Library API (pure, unit-tested):
 *   lockRef(env)                     → "refs/deploy-locks/<env>"
 *   formatLockPayload(payload)       → JSON string stored in the ref
 *   parseLockPayload(text)           → LockPayload (throws on malformed input)
 *   lockAgeMinutes(payload, now)     → age of the lock in minutes
 *   evaluateRelease(input)           → { ok: true } | { ok: false; reason }
 *   describeLock(payload, now)       → operator-facing one-liner
 *
 * Git-backed API (injectable via GitEnv, integration-tested):
 *   resolveRemote(explicit, gitEnv)  → verified remote name
 *   readLock(env, gitEnv)            → { payload, sha } | null
 *   acquireLock(payload, gitEnv)     → AcquireResult
 *   releaseLock(env, expectedSha, gitEnv) → ReleaseOutcome
 *
 * CLI:
 *   tsx scripts/deploy/deploy-lock.ts status  <env> [--remote <name>]
 *   tsx scripts/deploy/deploy-lock.ts acquire <env> [--note "..."] [--remote <name>]
 *   tsx scripts/deploy/deploy-lock.ts verify  <env> [--sha <commit>] [--remote <name>]
 *   tsx scripts/deploy/deploy-lock.ts release <env> [--force] [--remote <name>]
 *
 * `<env>` is `staging` or `production`. Exit code 0 = success, 1 = failure.
 */

import { execFileSync } from 'node:child_process';
import { argv, env as processEnv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

export type DeployEnv = 'staging' | 'production';

export const DEPLOY_ENVS: readonly DeployEnv[] = ['staging', 'production'];

/** Environment variable consulted when `--remote` is not passed. */
export const REMOTE_ENV_VAR = 'LINE_HARNESS_DEPLOY_REMOTE';

/** Fallback remote name, still verified against `git remote` before use. */
export const DEFAULT_REMOTE = 'origin';

/**
 * A lock older than this is reported as stale. Staleness is informational
 * only — it never auto-releases. Someone else's lock is released by a human
 * decision (`release --force`), never by a timer, because an expired-looking
 * lock usually means a deploy is still running or was interrupted midway.
 */
export const STALE_AFTER_MINUTES = 90;

export interface LockPayload {
  /** Environment the lock protects. */
  env: DeployEnv;
  /** GitHub login of the holder. */
  holder: string;
  /** Commit SHA the holder is about to deploy. */
  sha: string;
  /** ISO-8601 timestamp of acquisition. */
  startedAt: string;
  /** Free-form scope note, e.g. "紹介リンク一覧の列幅修正". */
  note: string;
}

/** Where git commands run, and which remote they talk to. */
export interface GitEnv {
  /** Working directory; defaults to the current process directory. */
  cwd?: string;
  /** Verified remote name. */
  remote: string;
}

export function isDeployEnv(value: string): value is DeployEnv {
  return (DEPLOY_ENVS as readonly string[]).includes(value);
}

export function lockRef(env: DeployEnv): string {
  return `refs/deploy-locks/${env}`;
}

export function formatLockPayload(payload: LockPayload): string {
  // Stable key order keeps the stored blob diffable when read via git show.
  const ordered = {
    env: payload.env,
    holder: payload.holder,
    sha: payload.sha,
    startedAt: payload.startedAt,
    note: payload.note,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function parseLockPayload(text: string): LockPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('ロック情報が壊れています（JSON として読めません）');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('ロック情報が壊れています（オブジェクトではありません）');
  }
  const rec = raw as Record<string, unknown>;
  for (const key of ['env', 'holder', 'sha', 'startedAt', 'note'] as const) {
    if (typeof rec[key] !== 'string') {
      throw new Error(`ロック情報が壊れています（${key} がありません）`);
    }
  }
  const value = rec.env as string;
  if (!isDeployEnv(value)) {
    throw new Error(`ロック情報が壊れています（未知の環境: ${value}）`);
  }
  return {
    env: value,
    holder: rec.holder as string,
    sha: rec.sha as string,
    startedAt: rec.startedAt as string,
    note: rec.note as string,
  };
}

export function lockAgeMinutes(payload: LockPayload, now: Date): number {
  const started = Date.parse(payload.startedAt);
  if (Number.isNaN(started)) return Number.NaN;
  return Math.floor((now.getTime() - started) / 60_000);
}

export interface ReleaseInput {
  lock: LockPayload;
  /** Who is asking to release. */
  holder: string;
  /** Explicit override for releasing someone else's lock. */
  force: boolean;
}

export type ReleaseResult = { ok: true } | { ok: false; reason: string };

/**
 * Releasing someone else's lock is the one operation that can silently break
 * a colleague's in-flight deploy, so it requires `--force` and is never
 * implied by staleness.
 */
export function evaluateRelease(input: ReleaseInput): ReleaseResult {
  if (input.lock.holder === input.holder) return { ok: true };
  if (input.force) return { ok: true };
  return {
    ok: false,
    reason:
      `ロックの保持者は ${input.lock.holder} さんです（あなたは ${input.holder}）。` +
      '本人に解放を依頼するか、状況を確認したうえで --force を付けてください。',
  };
}

export function describeLock(payload: LockPayload, now: Date): string {
  const age = lockAgeMinutes(payload, now);
  const ageText = Number.isNaN(age) ? '経過時間不明' : `${age}分経過`;
  const stale = !Number.isNaN(age) && age >= STALE_AFTER_MINUTES;
  const staleText = stale ? ` ※${STALE_AFTER_MINUTES}分以上経過。放置の可能性あり` : '';
  return (
    `${payload.env} は ${payload.holder} さんが使用中（${ageText}${staleText}）\n` +
    `  対象コミット: ${payload.sha}\n` +
    `  変更範囲    : ${payload.note}\n` +
    `  開始時刻    : ${payload.startedAt}`
  );
}

// ---------------------------------------------------------------------------
// git plumbing (side-effecting, but injectable through GitEnv)
// ---------------------------------------------------------------------------

/**
 * `stdio` is fully piped so git's own chatter (push rejection hints in
 * particular) never reaches the operator. A failed lock acquisition should
 * print our explanation of who holds it, not a fast-forward tutorial.
 */
function git(args: string[], gitEnv?: Pick<GitEnv, 'cwd'>, input?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd: gitEnv?.cwd,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function gitAllowFail(
  args: string[],
  gitEnv?: Pick<GitEnv, 'cwd'>,
): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(args, gitEnv) };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.toString().trim();
    return { ok: false, out };
  }
}

/**
 * Pick the deploy remote and prove it exists. Guessing a remote name would
 * mean pushing locks somewhere nobody else reads them, which is worse than
 * refusing to run.
 */
export function resolveRemote(
  explicit: string | undefined,
  gitEnv?: Pick<GitEnv, 'cwd'>,
): string {
  const candidate = explicit ?? processEnv[REMOTE_ENV_VAR] ?? DEFAULT_REMOTE;
  const configured = git(['remote'], gitEnv).split('\n').filter(Boolean);
  if (!configured.includes(candidate)) {
    throw new Error(
      `デプロイ対象の remote "${candidate}" が見つかりません` +
        `（設定済み: ${configured.join(', ') || 'なし'}）。` +
        `--remote または ${REMOTE_ENV_VAR} で指定してください。`,
    );
  }
  return candidate;
}

export interface ReadLock {
  payload: LockPayload;
  /** SHA of the ref, used as the lease when releasing. */
  sha: string;
}

export type VerifyLockResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'environment-mismatch' | 'sha-mismatch' };

/**
 * Prove that a deployment lock protects this exact environment and commit.
 *
 * The holder is deliberately not part of this check. A developer acquires the
 * lock locally, while GitHub Actions performs the deployment as a bot. What
 * must never differ is the environment or the immutable commit being deployed.
 */
export function evaluateLockForDeploy(
  lock: LockPayload | null,
  env: DeployEnv,
  sha: string,
): VerifyLockResult {
  if (!lock) return { ok: false, reason: 'missing' };
  if (lock.env !== env) return { ok: false, reason: 'environment-mismatch' };
  if (lock.sha !== sha) return { ok: false, reason: 'sha-mismatch' };
  return { ok: true };
}

/** Read the remote lock, or null when the ref does not exist. */
export function readLock(env: DeployEnv, gitEnv: GitEnv): ReadLock | null {
  const ref = lockRef(env);
  const ls = git(['ls-remote', gitEnv.remote, ref], gitEnv);
  if (!ls) return null;
  const sha = ls.split(/\s+/)[0];
  // Fetch the object so we can read the blob without a working-tree checkout.
  git(['fetch', '--quiet', gitEnv.remote, `+${ref}:${ref}`], gitEnv);
  return { payload: parseLockPayload(git(['show', `${sha}:lock.json`], gitEnv)), sha };
}

export type AcquireResult =
  | { ok: true }
  | { ok: false; existing: ReadLock | null; detail: string };

/**
 * Build an orphan commit holding the payload and push it into the lock ref.
 * A fresh orphan commit shares no history with any existing lock, so the
 * server rejects the push when the ref is already taken — that rejection is
 * the mutual exclusion.
 */
export function acquireLock(payload: LockPayload, gitEnv: GitEnv): AcquireResult {
  const blob = git(['hash-object', '-w', '--stdin'], gitEnv, formatLockPayload(payload));
  const tree = git(['mktree'], gitEnv, `100644 blob ${blob}\tlock.json\n`);
  const commit = git(
    [
      'commit-tree',
      tree,
      '-m',
      `deploy-lock(${payload.env}): ${payload.holder} ${payload.sha}`,
    ],
    gitEnv,
  );
  const pushed = gitAllowFail(
    ['push', '--quiet', gitEnv.remote, `${commit}:${lockRef(payload.env)}`],
    gitEnv,
  );
  if (pushed.ok) return { ok: true };
  return { ok: false, existing: readLock(payload.env, gitEnv), detail: pushed.out };
}

export type ReleaseOutcome =
  | { ok: true }
  | { ok: false; reason: 'lease-stale'; detail: string }
  | { ok: false; reason: 'push-failed'; detail: string };

/**
 * Delete the lock ref only if it still points at `expectedSha`.
 *
 * Without the lease this is a read-then-delete race: A reads the lock, B
 * acquires it a moment later (after A's own lock expired from A's point of
 * view, or after a forced release), and A's delete removes B's lock while B
 * is mid-deploy. `--force-with-lease=<ref>:<sha>` pushes the expected value
 * to the server and lets the server reject the delete instead.
 */
export function releaseLock(
  env: DeployEnv,
  expectedSha: string,
  gitEnv: GitEnv,
): ReleaseOutcome {
  const ref = lockRef(env);
  const result = gitAllowFail(
    [
      'push',
      '--quiet',
      `--force-with-lease=${ref}:${expectedSha}`,
      gitEnv.remote,
      `:${ref}`,
    ],
    gitEnv,
  );
  if (result.ok) return { ok: true };
  // git reports a failed lease as "stale info"; anything else is a real error.
  const stale = /stale info|force-with-lease/i.test(result.out);
  return {
    ok: false,
    reason: stale ? 'lease-stale' : 'push-failed',
    detail: result.out,
  };
}

/** Resolve the GitHub login of the current operator via the gh CLI. */
function currentHolder(): string {
  try {
    return execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      'GitHub ログインを取得できません。`gh auth login` を済ませてから実行してください。',
    );
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  stderr.write(
    [
      '使い方:',
      '  tsx scripts/deploy/deploy-lock.ts status  <staging|production> [--remote <name>]',
      '  tsx scripts/deploy/deploy-lock.ts acquire <staging|production> [--note "変更範囲"] [--remote <name>]',
      '  tsx scripts/deploy/deploy-lock.ts verify  <staging|production> [--sha <commit>] [--remote <name>]',
      '  tsx scripts/deploy/deploy-lock.ts release <staging|production> [--force] [--remote <name>]',
      '',
      `remote は --remote / ${REMOTE_ENV_VAR} / ${DEFAULT_REMOTE} の順で解決し、実在を確認します。`,
      '',
    ].join('\n'),
  );
  exit(1);
}

function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function main(): void {
  const args = argv.slice(2);
  const [command, envArg] = args;
  if (!command || !envArg || !isDeployEnv(envArg)) usage();
  const env = envArg;
  const now = new Date();
  const gitEnv: GitEnv = { remote: resolveRemote(readFlag(args, '--remote')) };

  if (command === 'status') {
    const current = readLock(env, gitEnv);
    if (!current) {
      stdout.write(`${env} は空いています（remote: ${gitEnv.remote}）。\n`);
      return;
    }
    stdout.write(`${describeLock(current.payload, now)}\n  ロックref SHA: ${current.sha}\n`);
    exit(1);
  }

  if (command === 'acquire') {
    const holder = currentHolder();
    const payload: LockPayload = {
      env,
      holder,
      sha: git(['rev-parse', 'HEAD']),
      startedAt: now.toISOString(),
      note: readFlag(args, '--note') ?? '(変更範囲の記載なし)',
    };
    const result = acquireLock(payload, gitEnv);
    if (!result.ok) {
      stderr.write(`${env} のロックを取得できませんでした。\n`);
      if (result.existing) stderr.write(`${describeLock(result.existing.payload, now)}\n`);
      else stderr.write(`${result.detail}\n`);
      exit(1);
    }
    stdout.write(
      `${env} のロックを取得しました（${holder} / ${payload.sha.slice(0, 7)} / ${payload.note}）。\n` +
        '終了後は必ず release してください。\n',
    );
    return;
  }

  if (command === 'verify') {
    const expectedSha = readFlag(args, '--sha') ?? git(['rev-parse', 'HEAD']);
    const current = readLock(env, gitEnv);
    const result = evaluateLockForDeploy(current?.payload ?? null, env, expectedSha);
    if (!result.ok) {
      if (result.reason === 'missing') {
        throw new Error(`${env} のデプロイロックがありません。先に acquire してください。`);
      }
      if (result.reason === 'environment-mismatch') {
        throw new Error(`ロックの対象環境が ${env} と一致しません。`);
      }
      throw new Error(
        `ロックの対象コミット ${current?.payload.sha ?? '(不明)'} が ` +
          `デプロイ対象 ${expectedSha} と一致しません。`,
      );
    }
    stdout.write(
      `${env} のロックはデプロイ対象 ${expectedSha} と一致しています` +
        `（保持者: ${current?.payload.holder}）。\n`,
    );
    return;
  }

  if (command === 'release') {
    const holder = currentHolder();
    const current = readLock(env, gitEnv);
    if (!current) {
      stdout.write(`${env} は既に空いています。\n`);
      return;
    }
    const verdict = evaluateRelease({
      lock: current.payload,
      holder,
      force: args.includes('--force'),
    });
    if (!verdict.ok) {
      stderr.write(`${verdict.reason}\n${describeLock(current.payload, now)}\n`);
      exit(1);
    }
    const outcome = releaseLock(env, current.sha, gitEnv);
    if (!outcome.ok) {
      if (outcome.reason === 'lease-stale') {
        stderr.write(
          `${env} のロックは、確認した時点から別の内容に変わっています。\n` +
            '別の担当者が取得し直した可能性があるため、削除しませんでした。\n' +
            'status で現在の保持者を確認してください。\n',
        );
      } else {
        stderr.write(`ロックを解放できませんでした。\n${outcome.detail}\n`);
      }
      exit(1);
    }
    stdout.write(`${env} のロックを解放しました。\n`);
    return;
  }

  usage();
}

// Only run the CLI when executed directly, so tests can import the API.
// pathToFileURL (not string interpolation) because the checkout path contains
// spaces, which import.meta.url percent-encodes and a raw path does not.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  try {
    main();
  } catch (err) {
    stderr.write(`${(err as Error).message}\n`);
    exit(1);
  }
}
