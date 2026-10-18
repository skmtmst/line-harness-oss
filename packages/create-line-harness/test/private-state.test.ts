import { describe, expect, it } from 'vitest';
import { mkdtempSync, chmodSync, writeFileSync, statSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePrivateState } from '../src/lib/private-state.js';

describe('F5: secret setup progress', () => {
  it('restricts both new and pre-existing state without leaving old contents', () => {
    const directory = mkdtempSync(join(tmpdir(), 'private-state-'));
    try {
      chmodSync(directory, 0o755);
      const path = join(directory, 'state.json');
      writeFileSync(path, 'old secret with a longer payload', { mode: 0o644 });
      writePrivateState(directory, path, '{}');
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(readFileSync(path, 'utf8')).toBe('{}');
      const fresh = join(directory, 'fresh.json');
      writePrivateState(directory, fresh, 'new');
      expect(statSync(fresh).mode & 0o777).toBe(0o600);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('does not follow an attacker-controlled state symlink', () => {
    const directory = mkdtempSync(join(tmpdir(), 'private-state-'));
    try {
      const target = join(directory, 'target');
      writeFileSync(target, 'unchanged');
      symlinkSync(target, join(directory, 'state'));
      expect(() => writePrivateState(directory, join(directory, 'state'), 'secret')).toThrow();
      expect(readFileSync(target, 'utf8')).toBe('unchanged');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
