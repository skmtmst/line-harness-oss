import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/security-scan.yml'), 'utf8');

function job(name: string): string {
  const body = workflow.split(`\n  ${name}:\n`)[1];
  if (!body) throw new Error(`job ${name} not found`);
  return body.split(/\n {2}[a-z][\w-]*:\n/)[0];
}

// Only the forms this workflow uses: a literal, or github.event_name compared with a quoted name.
function evaluate(value: string, event: string): boolean {
  const literal = value.trim();
  if (literal === 'true' || literal === 'false') return literal === 'true';
  const match = literal.match(/^\$\{\{\s*github\.event_name\s*(==|!=)\s*'([\w-]+)'\s*\}\}$/);
  if (!match) throw new Error(`Unexpected expression: ${literal}`);
  return match[1] === '==' ? event === match[2] : event !== match[2];
}

const audit = job('dependency-audit');
const jobContinue = audit.match(/^ {4}continue-on-error:(.*)$/m)![1];
const stepBlock = audit.split('- name: pnpm audit (production dependencies)')[1];
const stepContinue = stepBlock.match(/^ {8}continue-on-error:(.*)$/m)![1];
const script = stepBlock
  .split('run: |\n')[1]
  .split('\n')
  .filter((line, index, lines) => line.startsWith('          ') || (line === '' && index < lines.length - 1))
  .map((line) => line.slice(10))
  .join('\n');

function runAudit(event: string, auditExit: number) {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'security-scan-'));
  try {
    writeFileSync(resolve(sandbox, 'pnpm'), `#!/bin/sh\necho "fixture audit output"\nexit ${auditExit}\n`, { mode: 0o755 });
    const summary = resolve(sandbox, 'summary.md');
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: sandbox,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${sandbox}:${process.env.PATH}`, GITHUB_STEP_SUMMARY: summary, AUDIT_EVENT: event },
    });
    const stepFailed = result.status !== 0;
    // A failed step only turns the run red when neither the step nor the job swallows it.
    const red = stepFailed && !evaluate(stepContinue, event) && !evaluate(jobContinue, event);
    return { stepFailed, red, summary: readFileSync(summary, 'utf8') };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

describe('Security scan workflow: dependency audit', () => {
  it('runs on pull requests, the weekly schedule and manual runs, but not on push', () => {
    expect(workflow).toMatch(/^ {2}schedule:\n {4}# .*\n {4}- cron: '17 18 \* \* 0'$/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(audit).toMatch(/^ {4}if: github\.event_name != 'push'$/m);
  });

  it('only reports on pull requests when high or critical findings exist', () => {
    const result = runAudit('pull_request', 1);
    expect(result.stepFailed).toBe(true);
    expect(result.red).toBe(false);
    expect(result.summary).toContain('Report only on pull requests');
    expect(result.summary).toContain('fixture audit output');
  });

  it.each(['schedule', 'workflow_dispatch'])('turns the %s run red when high or critical findings exist', (event) => {
    const result = runAudit(event, 1);
    expect(result.red).toBe(true);
    expect(result.summary).toContain(`This ${event} run fails`);
    expect(result.summary).toContain('fixture audit output');
  });

  it.each(['pull_request', 'schedule', 'workflow_dispatch'])('stays green on %s when nothing high or critical is found', (event) => {
    const result = runAudit(event, 0);
    expect(result.stepFailed).toBe(false);
    expect(result.red).toBe(false);
    expect(result.summary).toContain('No high or critical vulnerabilities');
  });

  it('keeps CodeQL report only', () => {
    const codeql = job('codeql');
    expect(evaluate(codeql.match(/^ {4}continue-on-error:(.*)$/m)![1], 'schedule')).toBe(true);
  });
});
