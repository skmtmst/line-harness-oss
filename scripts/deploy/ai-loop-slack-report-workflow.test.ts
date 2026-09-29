import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/configure-ai-loop-slack-report.yml'),
  'utf8',
);

describe('Configure AI Loop Slack Reports workflow', () => {
  it('is a manual staging-only operation on the integration branch', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref == 'refs/heads/codex/development'");
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('default: verify');
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).not.toContain('apps/worker/wrangler.toml');
  });

  it('loads fixed GitHub secrets and never accepts their values as inputs', () => {
    expect(workflow).toContain('secrets.AI_LOOP_SLACK_REPORT_SECRET');
    expect(workflow).toContain('secrets.SLACK_AI_LOOP_CHANNEL_ID');
    expect(workflow).toContain('secrets.CLOUDFLARE_WORKERS_API_TOKEN');
    expect(workflow).not.toContain('inputs.channel');
    expect(workflow).not.toContain('inputs.secret');
    expect(workflow).not.toContain('echo "$AI_LOOP_SLACK_REPORT_SECRET"');
    expect(workflow).not.toContain('echo "$SLACK_AI_LOOP_CHANNEL_ID"');
  });

  it('uploads both settings together and removes the temporary file', () => {
    expect(workflow).toContain('wrangler secret bulk');
    expect(workflow).toContain('AI_LOOP_SLACK_REPORT_SECRET: process.env.AI_LOOP_SLACK_REPORT_SECRET');
    expect(workflow).toContain('SLACK_AI_LOOP_CHANNEL_ID: process.env.SLACK_AI_LOOP_CHANNEL_ID');
    expect(workflow).toContain('mode: 0o600');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('rm -f "$RUNNER_TEMP/ai-loop-slack-report-secrets.json"');
  });

  it('only verifies secret names and states that Slack input is disabled', () => {
    expect(workflow).toContain('wrangler secret list');
    expect(workflow).toContain('Values were not read.');
    expect(workflow).toContain('Slack input, command, approval: `disabled`');
  });
});
