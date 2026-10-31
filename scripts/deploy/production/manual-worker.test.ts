import { mkdtempSync, rmSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeDeployment, assertManualArgs, assertRecordDirectory } from './manual-worker.js';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

describe('manual Worker production gate', () => {
  it('accepts only a single fully active version as the rollback target', () => {
    expect(activeDeployment({ deployments: [{ id: uuidA, versions: [{ version_id: uuidB, percentage: 100 }] }] }))
      .toEqual({ deploymentId: uuidA, versionId: uuidB });
    for (const value of [
      {},
      { deployments: [] },
      { deployments: [{ id: uuidA, versions: [] }] },
      { deployments: [{ id: uuidA, versions: [{ version_id: uuidB, percentage: 50 }] }] },
      { deployments: [{ id: uuidA, versions: [{ version_id: uuidB, percentage: 50 }, { version_id: uuidA, percentage: 50 }] }] },
    ]) expect(() => activeDeployment(value)).toThrow('active_version_unknown');
  });

  it('requires an owner approval record and external receipt directory', () => {
    const args = ['--approval-ref', 'https://github.com/skmtmst/line-harness-oss/pull/2002#issuecomment-123', '--parent-repo', '/tmp/parent-repo', '--record-dir', '/tmp/release-receipts'];
    expect(assertManualArgs(args).apply).toBe(false);
    expect(assertManualArgs([...args, '--apply']).apply).toBe(true);
    expect(() => assertManualArgs(args.filter(arg => !arg.startsWith('https://')))).toThrow('approval_record');
    expect(() => assertManualArgs([...args, '--dry-run', '--apply'])).toThrow('conflicting_mode');
    expect(() => assertManualArgs([...args, '--bad'])).toThrow('unknown_argument');
    expect(() => assertManualArgs([...args.slice(0, -1), `${process.cwd()}/receipt`])).toThrow('paths');
  });

  it('rejects reused and public receipt directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manual-worker-'));
    try {
      chmodSync(dir, 0o700);
      expect(assertRecordDirectory(dir)).toBe(realpathSync(dir));
      writeFileSync(join(dir, 'old-receipt'), 'existing');
      expect(() => assertRecordDirectory(dir)).toThrow('record_directory_unsafe');
      rmSync(join(dir, 'old-receipt'));
      chmodSync(dir, 0o755);
      expect(() => assertRecordDirectory(dir)).toThrow('record_directory_unsafe');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
