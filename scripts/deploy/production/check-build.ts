/** CI-only artifact check. No network, credentials, publication or config mutation. */
import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';
import { assertWorkerConfig, verifyHeaders, workerArtifactPath } from './artifacts.js';
import { result } from './common.js';
try {
  const target = process.argv[2];
  if (target !== 'worker' && target !== 'admin') throw new Error('target');
  if (target === 'worker') {
    const source = unstable_readConfig({ config: 'apps/worker/wrangler.toml' });
    assertWorkerConfig(source, JSON.parse(readFileSync(workerArtifactPath(source.name), 'utf8')));
  }
  verifyHeaders(target);
  result('offline_build_artifact', true);
} catch {
  result('offline_build_artifact', false);
  process.exitCode = 1;
}
