/**
 * Integration tests for the git-backed half of the deploy lock.
 *
 * These drive real `git` against a temporary bare repository standing in for
 * the deploy remote, because the properties that matter — who wins a
 * simultaneous acquire, and whether a stale release can delete somebody
 * else's lock — are enforced by the server's ref update rules, not by our
 * code. A mocked git would test the mock.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type GitEnv,
  type LockPayload,
  REMOTE_ENV_VAR,
  acquireLock,
  readLock,
  releaseLock,
  resolveRemote,
} from './deploy-lock';

let root: string;
let bare: string;
let devA: GitEnv;
let devB: GitEnv;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function clone(name: string, remoteName: string): GitEnv {
  const dir = join(root, name);
  git(['clone', '--quiet', '--origin', remoteName, bare, dir], root);
  git(['config', 'user.name', name], dir);
  git(['config', 'user.email', `${name}@example.test`], dir);
  return { cwd: dir, remote: remoteName };
}

function payload(holder: string, note: string): LockPayload {
  return {
    env: 'staging',
    holder,
    sha: '6564955f9363ca00552a4e46eaf9fad3e07ca95c',
    startedAt: '2026-08-14T02:00:00.000Z',
    note,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'deploy-lock-test-'));
  bare = join(root, 'remote.git');
  git(['init', '--quiet', '--bare', bare], root);

  // Seed the bare repo so clones have a HEAD to work from.
  const seed = join(root, 'seed');
  git(['clone', '--quiet', bare, seed], root);
  git(['config', 'user.name', 'seed'], seed);
  git(['config', 'user.email', 'seed@example.test'], seed);
  git(['commit', '--quiet', '--allow-empty', '-m', 'init'], seed);
  git(['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], seed);

  devA = clone('devA', 'origin');
  devB = clone('devB', 'origin');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('grants the lock when the ref is free', () => {
    expect(acquireLock(payload('kenta', '安全ゲート'), devA)).toEqual({ ok: true });
    expect(readLock('staging', devB)?.payload.holder).toBe('kenta');
  });

  it('rejects a second acquire and reports the current holder', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const result = acquireLock(payload('masato', '紹介リンク'), devB);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.existing?.payload.holder).toBe('kenta');
      expect(result.existing?.payload.note).toBe('安全ゲート');
    }
  });

  it('keeps environments independent', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const prod = { ...payload('masato', '本番作業'), env: 'production' as const };
    expect(acquireLock(prod, devB)).toEqual({ ok: true });
    expect(readLock('staging', devA)?.payload.holder).toBe('kenta');
    expect(readLock('production', devA)?.payload.holder).toBe('masato');
  });
});

describe('readLock', () => {
  it('returns null when nothing holds the environment', () => {
    expect(readLock('staging', devA)).toBeNull();
  });

  it('reports the ref SHA so it can be used as a release lease', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const current = readLock('staging', devA);
    expect(current?.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('releaseLock', () => {
  it('releases when the ref still matches the lease', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const current = readLock('staging', devA);
    expect(current).not.toBeNull();
    expect(releaseLock('staging', current!.sha, devA)).toEqual({ ok: true });
    expect(readLock('staging', devA)).toBeNull();
  });

  it('lets the environment be re-acquired after a release', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const first = readLock('staging', devA)!;
    releaseLock('staging', first.sha, devA);
    expect(acquireLock(payload('masato', '紹介リンク'), devB)).toEqual({ ok: true });
  });

  /**
   * The race this guards: A reads the lock, and before A's release lands the
   * lock is released and re-acquired by B. An unconditional delete would wipe
   * out B's lock while B is mid-deploy — exactly the collision the lock exists
   * to prevent.
   */
  it('refuses to delete a lock that was re-acquired after it was read', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const asKentaSawIt = readLock('staging', devA)!;

    // kenta finishes and releases; masato immediately takes staging.
    releaseLock('staging', asKentaSawIt.sha, devA);
    acquireLock(payload('masato', '紹介リンク'), devB);
    const masatosLock = readLock('staging', devB)!;
    expect(masatosLock.sha).not.toBe(asKentaSawIt.sha);

    // kenta's stale release (e.g. a retry, or a second terminal) must not win.
    const stale = releaseLock('staging', asKentaSawIt.sha, devA);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe('lease-stale');

    // masato still holds the lock.
    expect(readLock('staging', devA)?.payload.holder).toBe('masato');
  });

  it('refuses a lease that never matched the ref at all', () => {
    acquireLock(payload('kenta', '安全ゲート'), devA);
    const result = releaseLock('staging', 'f'.repeat(40), devB);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('lease-stale');
    expect(readLock('staging', devA)?.payload.holder).toBe('kenta');
  });
});

describe('resolveRemote', () => {
  const saved = process.env[REMOTE_ENV_VAR];

  afterEach(() => {
    if (saved === undefined) delete process.env[REMOTE_ENV_VAR];
    else process.env[REMOTE_ENV_VAR] = saved;
  });

  it('accepts an explicitly named remote that exists', () => {
    expect(resolveRemote('origin', devA)).toBe('origin');
  });

  it('supports a fork whose remote is not called origin', () => {
    const forked = clone('devFork', 'fork');
    expect(resolveRemote('fork', forked)).toBe('fork');
  });

  it('falls back to the environment variable when no flag is given', () => {
    const forked = clone('devFork2', 'fork');
    process.env[REMOTE_ENV_VAR] = 'fork';
    expect(resolveRemote(undefined, forked)).toBe('fork');
  });

  it('stops instead of guessing when the remote does not exist', () => {
    delete process.env[REMOTE_ENV_VAR];
    const forked = clone('devFork3', 'fork');
    // Default is `origin`, which this checkout does not have.
    expect(() => resolveRemote(undefined, forked)).toThrow(/origin/);
  });

  it('names the configured remotes in the error so the fix is obvious', () => {
    const forked = clone('devFork4', 'fork');
    expect(() => resolveRemote('upstream', forked)).toThrow(/fork/);
  });
});
