import { describe, expect, it } from 'vitest';
import {
  type LockPayload,
  STALE_AFTER_MINUTES,
  describeLock,
  evaluateLockForDeploy,
  evaluateRelease,
  formatLockPayload,
  isDeployEnv,
  lockAgeMinutes,
  lockRef,
  parseLockPayload,
} from './deploy-lock';

const lock: LockPayload = {
  env: 'staging',
  holder: 'kentavndng',
  sha: '6564955f9363ca00552a4e46eaf9fad3e07ca95c',
  startedAt: '2026-08-14T02:00:00.000Z',
  note: '紹介リンク一覧の列幅修正',
};

describe('lockRef', () => {
  it('namespaces locks per environment', () => {
    expect(lockRef('staging')).toBe('refs/deploy-locks/staging');
    expect(lockRef('production')).toBe('refs/deploy-locks/production');
  });
});

describe('isDeployEnv', () => {
  it('accepts the two known environments', () => {
    expect(isDeployEnv('staging')).toBe(true);
    expect(isDeployEnv('production')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDeployEnv('stg')).toBe(false);
    expect(isDeployEnv('')).toBe(false);
  });
});

describe('formatLockPayload / parseLockPayload', () => {
  it('round-trips a payload', () => {
    expect(parseLockPayload(formatLockPayload(lock))).toEqual(lock);
  });

  it('writes keys in a stable order so stored blobs stay diffable', () => {
    const keys = Object.keys(JSON.parse(formatLockPayload(lock)));
    expect(keys).toEqual(['env', 'holder', 'sha', 'startedAt', 'note']);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseLockPayload('not json')).toThrow(/JSON/);
  });

  it('rejects a payload missing a field', () => {
    const { note: _note, ...rest } = lock;
    expect(() => parseLockPayload(JSON.stringify(rest))).toThrow(/note/);
  });

  it('rejects an unknown environment', () => {
    expect(() =>
      parseLockPayload(JSON.stringify({ ...lock, env: 'sandbox' })),
    ).toThrow(/sandbox/);
  });
});

describe('lockAgeMinutes', () => {
  it('measures elapsed minutes', () => {
    const now = new Date('2026-08-14T02:45:00.000Z');
    expect(lockAgeMinutes(lock, now)).toBe(45);
  });

  it('returns NaN for an unparseable timestamp', () => {
    const broken = { ...lock, startedAt: 'yesterday' };
    expect(Number.isNaN(lockAgeMinutes(broken, new Date()))).toBe(true);
  });
});

describe('evaluateRelease', () => {
  it('lets the holder release their own lock', () => {
    expect(evaluateRelease({ lock, holder: 'kentavndng', force: false })).toEqual({
      ok: true,
    });
  });

  it('blocks releasing someone else without --force', () => {
    const result = evaluateRelease({ lock, holder: 'skmtmst', force: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('kentavndng');
  });

  it('allows releasing someone else with --force', () => {
    expect(evaluateRelease({ lock, holder: 'skmtmst', force: true })).toEqual({
      ok: true,
    });
  });

  it('does not auto-release a stale lock — staleness is informational only', () => {
    const stale = { ...lock, startedAt: '2026-08-13T00:00:00.000Z' };
    const result = evaluateRelease({ lock: stale, holder: 'skmtmst', force: false });
    expect(result.ok).toBe(false);
  });
});

describe('evaluateLockForDeploy', () => {
  it('accepts the exact environment and commit', () => {
    expect(evaluateLockForDeploy(lock, 'staging', lock.sha)).toEqual({ ok: true });
  });

  it('rejects a missing lock', () => {
    expect(evaluateLockForDeploy(null, 'staging', lock.sha)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('rejects a lock for another environment', () => {
    expect(
      evaluateLockForDeploy({ ...lock, env: 'production' }, 'staging', lock.sha),
    ).toEqual({ ok: false, reason: 'environment-mismatch' });
  });

  it('rejects a lock for another commit', () => {
    expect(evaluateLockForDeploy(lock, 'staging', 'f'.repeat(40))).toEqual({
      ok: false,
      reason: 'sha-mismatch',
    });
  });
});

describe('describeLock', () => {
  it('reports holder, commit, scope and elapsed time', () => {
    const text = describeLock(lock, new Date('2026-08-14T02:30:00.000Z'));
    expect(text).toContain('kentavndng');
    expect(text).toContain('30分経過');
    expect(text).toContain('紹介リンク一覧の列幅修正');
    expect(text).not.toContain('放置の可能性あり');
  });

  it('flags a lock older than the stale threshold', () => {
    const now = new Date(
      Date.parse(lock.startedAt) + (STALE_AFTER_MINUTES + 1) * 60_000,
    );
    expect(describeLock(lock, now)).toContain('放置の可能性あり');
  });
});
