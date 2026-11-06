import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, chmodSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('F32: isolated credential directory', () => {
  it('uses a private unpredictable default root', () => {
    const result = spawnSync('bash', ['scripts/deploy/run-create-line-harness-sandbox.sh', '--', 'node', '-e', "const fs=require('fs');const p=process.env.LINE_HARNESS_SANDBOX_ROOT;if((fs.statSync(p).mode&511)!==448)process.exit(9);fs.rmSync(p,{recursive:true})"], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain('/private/tmp/line-harness-sandboxes/default');
  });
  it('refuses reusable readable roots and symbolic links before reset', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sandbox-security-'));
    try {
      const root = join(parent, 'readable'); mkdirSync(root); chmodSync(root, 0o755);
      const link = join(parent, 'link'); symlinkSync(root, link);
      for (const target of [root, link]) {
        const result = spawnSync('bash', ['scripts/deploy/run-create-line-harness-sandbox.sh', '--root', target, '--reset', '--', 'true'], { encoding: 'utf8' });
        expect(result.status, result.stdout).not.toBe(0);
        expect(result.stderr).toContain('Unsafe sandbox path');
      }
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
  it('keeps a private workspace reusable when dependency files contain symlinks', () => {
    const parent = mkdtempSync(join(tmpdir(), 'sandbox-reuse-'));
    try {
      const root = join(parent, 'root'); mkdirSync(root, { mode: 0o700 });
      const work = join(root, 'work'); mkdirSync(work, { mode: 0o700 });
      writeFileSync(join(work, 'ordinary-file'), 'source', { mode: 0o644 });
      symlinkSync(join(work, 'ordinary-file'), join(work, 'dependency-link'));
      const result = spawnSync('bash', ['scripts/deploy/run-create-line-harness-sandbox.sh', '--root', root, '--', 'true'], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });

});
