import { describe, expect, it } from 'vitest';
import { WORKER_COMPATIBILITY_FLAGS } from '@line-harness/update-engine';
import {
  renderInstalledWranglerToml,
  type InstalledWranglerConfig,
} from '../src/lib/installed-wrangler.js';

const CONFIG: InstalledWranglerConfig = {
  workerName: 'test-worker',
  accountId: 'account-1',
  d1DatabaseName: 'test-db',
  d1DatabaseId: 'db-1',
  r2BucketName: 'test-images',
  workerPublicUrl: 'https://test-worker.example.workers.dev',
  adminPagesProject: 'test-admin',
  adminPublicUrl: 'https://test-admin.pages.dev',
  liffPagesProject: 'test-liff',
  liffPublicUrl: 'https://test-liff.pages.dev',
  manifestUrl: 'https://example.com/manifest.json',
  workerDeployMode: 'source',
};

describe('renderInstalledWranglerToml', () => {
  it('共有の compatibility flags を落とさず書き出す', () => {
    const toml = renderInstalledWranglerToml(CONFIG);
    for (const flag of WORKER_COMPATIBILITY_FLAGS) {
      expect(toml).toContain(`"${flag}"`);
    }
  });
});
