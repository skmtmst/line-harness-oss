import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = resolve(testDirectory, '../..');
const script = join(testDirectory, 'apply-d1-migrations.sh');
const migrations = [
  'packages/db/migrations/001_round2.sql',
  'packages/db/migrations/002_round3.sql',
  'packages/db/migrations/003_entry_routes.sql',
];

let root: string;
let binDirectory: string;
let pendingFile: string;
let commandLog: string;
let summaryFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apply-d1-migrations-'));
  binDirectory = join(root, 'bin');
  pendingFile = join(root, 'pending.txt');
  commandLog = join(root, 'commands.log');
  summaryFile = join(root, 'summary.md');

  mkdirSync(binDirectory);

  const fakeNpx = join(binDirectory, 'npx');
  writeFileSync(
    fakeNpx,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_NPX_LOG"
if [ -n "\${FAKE_NPX_FAIL_FILE:-}" ] && [[ "$*" == *"--file=$FAKE_NPX_FAIL_FILE"* ]]; then
  exit 42
fi
`,
  );
  chmodSync(fakeNpx, 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(failFile = '') {
  return spawnSync('bash', [script, 'test-database', pendingFile], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      FAKE_NPX_LOG: commandLog,
      FAKE_NPX_FAIL_FILE: failFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
}

describe('apply-d1-migrations.sh', () => {
  it('does nothing when the fixed pending list is empty', () => {
    writeFileSync(pendingFile, '');

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No pending migrations.');
    expect(() => readFileSync(commandLog, 'utf8')).toThrow();
  });

  it('applies only the listed files and records them with INSERT OR IGNORE', () => {
    writeFileSync(pendingFile, `${migrations[0]}\n`);

    const result = run();
    const commands = readFileSync(commandLog, 'utf8');

    expect(result.status).toBe(0);
    expect(commands).toContain(`--file=${migrations[0]}`);
    expect(commands).toContain('INSERT OR IGNORE INTO _migrations');
    expect(commands).not.toContain(migrations[1]);
  });

  it('stops at the first failed file and reports the exact stopping point', () => {
    writeFileSync(pendingFile, `${migrations.join('\n')}\n`);

    const result = run(migrations[1]);
    const commands = readFileSync(commandLog, 'utf8');
    const summary = readFileSync(summaryFile, 'utf8');

    expect(result.status).not.toBe(0);
    expect(commands).toContain(`--file=${migrations[0]}`);
    expect(commands).toContain(`--file=${migrations[1]}`);
    expect(commands).not.toContain(`--file=${migrations[2]}`);
    expect(summary).toContain('001_round2.sql');
    expect(summary).toContain('002_round3.sql');
    expect(summary).toContain(
      'このファイルの内容をDBの現状と照らして確認してから、再度実行してください。',
    );
  });
});
