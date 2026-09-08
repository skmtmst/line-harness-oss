import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKER_COMPATIBILITY_FLAGS } from '../src/compat-flags.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function tomlFlags(path: string): string {
  const text = readFileSync(join(REPO_ROOT, path), 'utf8');
  const match = /compatibility_flags\s*=\s*\[([^\]]*)\]/.exec(text);
  if (!match) throw new Error(`compatibility_flags not found in ${path}`);
  return match[1];
}

describe('WORKER_COMPATIBILITY_FLAGS', () => {
  it('strict-public 境界を保つ', () => {
    expect(WORKER_COMPATIBILITY_FLAGS).toContain('nodejs_compat');
    expect(WORKER_COMPATIBILITY_FLAGS).toContain('global_fetch_strictly_public');
  });

  it('本番・検証の wrangler と一致する', () => {
    for (const path of ['apps/worker/wrangler.toml', 'apps/worker/wrangler.staging.toml']) {
      const flags = tomlFlags(path);
      for (const flag of WORKER_COMPATIBILITY_FLAGS) {
        expect(flags, path).toContain(`"${flag}"`);
      }
    }
  });
});
