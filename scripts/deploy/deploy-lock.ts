#!/usr/bin/env tsx
/**
 * Distributed deploy lock backed by a git ref on `origin`.
 *
 * Why a git ref: the validation stack (Worker `nen-line-stg`, D1, R2, Pages,
 * and the test LINE channel) exists exactly once, so two developers deploying
 * at the same time silently invalidate each other's verification. We need
 * mutual exclusion that every developer can see, but we do not want to add
 * infrastructure. A ref under `refs/deploy-locks/<env>` gives us that for
 * free: `git push` of a fresh orphan commit into an already-occupied ref is
 * rejected as non-fast-forward by the server, so "who got the lock" is decided
 * atomically by GitHub rather than by a check-then-act race on the client.
 *
 * The lock never touches the working tree: the payload is written with git
 * plumbing (hash-object / mktree / commit-tree), so acquiring a lock cannot
 * violate the clean-worktree gate in AGENTS.md.
 *
 * Library API (pure, unit-tested):
 *   lockRef(env)                     → "refs/deploy-locks/<env>"
 *   formatLockPayload(payload)       → JSON string stored in the ref
 *   parseLockPayload(text)           → LockPayload (throws on malformed input)
 *   lockAgeMinutes(payload, now)     → age of the lock in minutes
 *   evaluateRelease(input)           → { ok: true } | { ok: false; reason }
 *   describeLock(payload, now)       → operator-facing one-liner
 *
 * CLI:
 *   tsx scripts/deploy/deploy-lock.ts status  <env>
 *   tsx scripts/deploy/deploy-lock.ts acquire <env> [--note "..."]
 *   tsx scripts/deploy/deploy-lock.ts release <env> [--force]
 *
 * `<env>` is `staging` or `production`. Exit code 0 = success, 1 = failure.
 */

import { execFileSync } from 'node:child_process';
import { argv, exit, stderr, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

export type DeployEnv = 'staging' | 'production';

export const DEPLOY_ENVS: readonly DeployEnv[] = ['staging', 'production'];

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
  const env = rec.env as string;
  if (!isDeployEnv(env)) {
    throw new Error(`ロック情報が壊れています（未知の環境: ${env}）`);
  }
  return {
    env,
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
// git plumbing (side-effecting; kept out of the pure API above)
// ---------------------------------------------------------------------------

/**
 * `stdio` is fully piped so git's own chatter (push rejection hints in
 * particular) never reaches the operator. A failed lock acquisition should
 * print our explanation of who holds it, not a fast-forward tutorial.
 */
function git(args: string[], input?: string): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function gitAllowFail(args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(args) };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.toString().trim();
    return { ok: false, out };
  }
}

/** Resolve the GitHub login of the current operator via the gh CLI. */
function currentHolder(): string {
  try {
    return execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(
      'GitHub ログインを取得できません。`gh auth login` を済ませてから実行してください。',
    );
  }
}

/** Read the remote lock, or null when the ref does not exist. */
function readRemoteLock(env: DeployEnv): LockPayload | null {
  const ref = lockRef(env);
  const ls = git(['ls-remote', 'origin', ref]);
  if (!ls) return null;
  const sha = ls.split(/\s+/)[0];
  // Fetch the object so we can read the blob without a working-tree checkout.
  git(['fetch', '--quiet', 'origin', `+${ref}:${ref}`]);
  const text = git(['show', `${sha}:lock.json`]);
  return parseLockPayload(text);
}

/**
 * Build an orphan commit holding the payload and push it into the lock ref.
 * A fresh orphan commit shares no history with any existing lock, so the
 * server rejects the push when the ref is already taken — that rejection is
 * the mutual exclusion.
 */
function pushLock(payload: LockPayload): { ok: boolean; out: string } {
  const blob = git(['hash-object', '-w', '--stdin'], formatLockPayload(payload));
  const tree = git(['mktree'], `100644 blob ${blob}\tlock.json\n`);
  const commit = git([
    'commit-tree',
    tree,
    '-m',
    `deploy-lock(${payload.env}): ${payload.holder} ${payload.sha}`,
  ]);
  return gitAllowFail([
    'push',
    '--quiet',
    'origin',
    `${commit}:${lockRef(payload.env)}`,
  ]);
}

function deleteLock(env: DeployEnv): { ok: boolean; out: string } {
  return gitAllowFail(['push', '--quiet', 'origin', `:${lockRef(env)}`]);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  stderr.write(
    [
      '使い方:',
      '  tsx scripts/deploy/deploy-lock.ts status  <staging|production>',
      '  tsx scripts/deploy/deploy-lock.ts acquire <staging|production> [--note "変更範囲"]',
      '  tsx scripts/deploy/deploy-lock.ts release <staging|production> [--force]',
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

  if (command === 'status') {
    const lock = readRemoteLock(env);
    if (!lock) {
      stdout.write(`${env} は空いています。\n`);
      return;
    }
    stdout.write(`${describeLock(lock, now)}\n`);
    exit(1);
  }

  if (command === 'acquire') {
    const holder = currentHolder();
    const sha = git(['rev-parse', 'HEAD']);
    const note = readFlag(args, '--note') ?? '(変更範囲の記載なし)';
    const payload: LockPayload = {
      env,
      holder,
      sha,
      startedAt: now.toISOString(),
      note,
    };
    const pushed = pushLock(payload);
    if (!pushed.ok) {
      const existing = readRemoteLock(env);
      stderr.write(`${env} のロックを取得できませんでした。\n`);
      if (existing) stderr.write(`${describeLock(existing, now)}\n`);
      else stderr.write(`${pushed.out}\n`);
      exit(1);
    }
    stdout.write(
      `${env} のロックを取得しました（${holder} / ${sha.slice(0, 7)} / ${note}）。\n` +
        '終了後は必ず release してください。\n',
    );
    return;
  }

  if (command === 'release') {
    const holder = currentHolder();
    const lock = readRemoteLock(env);
    if (!lock) {
      stdout.write(`${env} は既に空いています。\n`);
      return;
    }
    const verdict = evaluateRelease({
      lock,
      holder,
      force: args.includes('--force'),
    });
    if (!verdict.ok) {
      stderr.write(`${verdict.reason}\n${describeLock(lock, now)}\n`);
      exit(1);
    }
    const deleted = deleteLock(env);
    if (!deleted.ok) {
      stderr.write(`ロックを解放できませんでした。\n${deleted.out}\n`);
      exit(1);
    }
    stdout.write(`${env} のロックを解放しました。\n`);
    return;
  }

  usage();
}

// Only run the CLI when executed directly, so tests can import the pure API.
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
