import { mkdtempSync, rmSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { activeDeployment, assertManualArgs, assertRecordDirectory, assertStagingDeployment, backupBookmark, verifyHotfixResponses, versionCommit } from './manual-worker.js';

const uuidA = '11111111-1111-4111-8111-111111111111';
const uuidB = '22222222-2222-4222-8222-222222222222';

describe('manual Worker production gate', () => {
  it('accepts only a single fully active version as the rollback target', () => {
    expect(activeDeployment({ id: uuidA, versions: [{ version_id: uuidB, percentage: 100 }] }))
      .toEqual({ deploymentId: uuidA, versionId: uuidB });
    for (const value of [
      {},
      { id: uuidA, versions: [] },
      { id: uuidA, versions: [{ version_id: uuidB, percentage: 50 }] },
      { id: uuidA, versions: [{ version_id: uuidB, percentage: 50 }, { version_id: uuidA, percentage: 50 }] },
    ]) expect(() => activeDeployment(value)).toThrow('active_version_unknown');
  });

  it('requires an owner approval record and external receipt directory', () => {
    const args = ['--approval-ref', 'https://github.com/skmtmst/line-harness-oss/pull/2002#issuecomment-123', '--parent-repo', '/tmp/parent-repo', '--record-dir', '/tmp/release-receipts', '--target-checkout', '/tmp/main-checkout', '--staging-version', uuidA, '--staging-deployment', uuidB];
    expect(assertManualArgs(args).apply).toBe(false);
    expect(assertManualArgs([...args, '--apply']).apply).toBe(true);
    expect(assertManualArgs(args.slice(2)).apply).toBe(false);
    expect(() => assertManualArgs([...args.slice(2), '--apply'])).toThrow('approval_record');
    expect(() => assertManualArgs([...args, '--dry-run', '--apply'])).toThrow('conflicting_mode');
    expect(() => assertManualArgs([...args, '--bad'])).toThrow('unknown_argument');
    expect(() => assertManualArgs([...args.slice(0, 5), '/tmp/main-checkout/receipt', ...args.slice(6)])).toThrow('paths');
    expect(() => assertManualArgs(args.filter(arg => arg !== uuidA))).toThrow('staging_proof_ids');
  });

  it('accepts only a D1 Time Travel restore bookmark', () => {
    const bookmark = '11111111-22222222-33333333-55555555555555555555555555555555';
    expect(backupBookmark({ bookmark })).toBe(bookmark);
    expect(() => backupBookmark({ bookmark: 'invalid' })).toThrow('backup_bookmark');
  });

  it('requires the staged 100% deployment and its recorded source SHA', () => {
    const sha = '1eb53a9875b38af3c511d5ca8d594064886df62a';
    expect(versionCommit({ resources: { bindings: [{ name: 'BUILD_GIT_COMMIT', type: 'plain_text', text: sha }] } })).toBe(sha);
    expect(() => versionCommit({ resources: { bindings: [] } })).toThrow('version_commit_missing');
    expect(() => versionCommit({ resources: { bindings: [{ name: 'BUILD_GIT_COMMIT', type: 'secret_text', text: sha }] } })).toThrow('version_commit_missing');
    expect(() => versionCommit({ resources: { bindings: [{ name: 'BUILD_GIT_COMMIT', type: 'plain_text', text: uuidA }] } })).toThrow('release_sha');
    expect(() => assertStagingDeployment({ versions: [{ version_id: uuidA, percentage: 100 }] }, uuidA)).not.toThrow();
    expect(() => assertStagingDeployment({ versions: [{ version_id: uuidA, percentage: 50 }] }, uuidA)).toThrow('staging_deployment_mismatch');
    expect(() => assertStagingDeployment({ versions: [{ version_id: uuidB, percentage: 100 }] }, uuidA)).toThrow('staging_deployment_mismatch');
  });

  it('checks the live responses that the main hotfix actually serves', async () => {
    const fetcher = vi.fn(async (url: string) => new Response('', {
      status: url.endsWith('/api/accounts') ? 401 : 200,
      headers: { 'content-type': url.endsWith('/api/accounts') ? 'application/json' : 'text/html' },
    })) as unknown as typeof fetch;
    await expect(verifyHotfixResponses(fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => new Response('', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    await expect(verifyHotfixResponses(bad)).rejects.toThrow('production_response');
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
