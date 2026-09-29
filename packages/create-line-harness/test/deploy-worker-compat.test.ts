import { describe, expect, it } from 'vitest';
import { WORKER_COMPATIBILITY_FLAGS } from '@line-harness/update-engine';
import { renderDeployWranglerToml } from '../src/steps/deploy-worker.js';

const ARGS = {
  workerName: 'test-worker',
  accountId: 'account-1',
  d1DatabaseName: 'test-db',
  d1DatabaseId: 'db-1',
  r2BucketName: 'test-images',
  main: 'src/index.ts',
  noBundle: false,
};

describe('renderDeployWranglerToml', () => {
  it('初回setupの一時設定にも共有の compatibility flags を載せる', () => {
    for (const toml of [
      renderDeployWranglerToml(ARGS),
      renderDeployWranglerToml({ ...ARGS, main: 'dist/release/index.js', noBundle: true }),
    ]) {
      for (const flag of WORKER_COMPATIBILITY_FLAGS) {
        expect(toml).toContain(`"${flag}"`);
      }
    }
  });
});
