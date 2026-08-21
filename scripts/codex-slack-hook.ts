import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

type HookInput = {
  session_id?: string;
  turn_id?: string;
  cwd?: string;
  hook_event_name?: string;
  prompt?: string;
  last_assistant_message?: string | null;
  tool_input?: { description?: string | null } & Record<string, unknown>;
};

type GitContext = {
  repository?: string;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
};

function run(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    }).trim() || null;
  } catch {
    return null;
  }
}

export function repositoryFromRemote(remote: string | null): string | undefined {
  if (!remote) return undefined;
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return match?.[1];
}

export function hookEventType(hookEventName: string | undefined): 'prompt_submitted' | 'turn_completed' | 'approval_required' | null {
  if (hookEventName === 'UserPromptSubmit') return 'prompt_submitted';
  if (hookEventName === 'Stop') return 'turn_completed';
  if (hookEventName === 'PermissionRequest') return 'approval_required';
  return null;
}

function gitContext(cwd: string): GitContext {
  const repository = repositoryFromRemote(run('git', ['remote', 'get-url', 'origin'], cwd));
  const branch = run('git', ['branch', '--show-current'], cwd) || undefined;
  const pr = run('gh', ['pr', 'view', '--json', 'number,url', '--jq', '[.number,.url]|@tsv'], cwd);
  const [rawNumber, prUrl] = pr?.split('\t') || [];
  const prNumber = rawNumber && /^\d+$/.test(rawNumber) ? Number(rawNumber) : undefined;
  return { repository, branch, prNumber, prUrl: prUrl || undefined };
}

function contentFor(input: HookInput): string {
  if (input.hook_event_name === 'UserPromptSubmit') return input.prompt || '';
  if (input.hook_event_name === 'Stop') return input.last_assistant_message || '';
  if (input.hook_event_name === 'PermissionRequest') {
    return input.tool_input?.description || 'Codexが作業を続けるための承認を待っています。';
  }
  return '';
}

function operator(): 'kenta' | 'masato' | 'codex' {
  const configured = (process.env.CODEX_OPERATOR || '').toLowerCase();
  if (configured === 'kenta' || configured === 'masato' || configured === 'codex') return configured;
  const gitName = (run('git', ['config', 'user.name'], process.cwd()) || '').toLowerCase();
  if (gitName.includes('masato') || gitName.includes('マサト')) return 'masato';
  if (gitName.includes('kenta') || gitName.includes('ケンタ')) return 'kenta';
  return 'codex';
}

function result(systemMessage?: string): void {
  process.stdout.write(JSON.stringify(systemMessage ? { systemMessage } : {}));
}

async function readInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as HookInput;
}

export async function sendHookEvent(input: HookInput): Promise<void> {
  const relayUrl = process.env.CODEX_SLACK_RELAY_URL;
  const secret = process.env.CODEX_SLACK_RELAY_SECRET;
  const required = process.env.CODEX_SLACK_SYNC_REQUIRED === '1';
  if (!relayUrl || !secret) {
    result(required ? 'Slack自動報告が未設定です。CODEX_SLACK_RELAY_URLとCODEX_SLACK_RELAY_SECRETを設定してください。' : undefined);
    return;
  }
  const eventType = hookEventType(input.hook_event_name);
  const content = contentFor(input).trim();
  if (!eventType || !content) {
    result();
    return;
  }
  const cwd = input.cwd || process.cwd();
  const context = gitContext(cwd);
  const sessionId = input.session_id || 'unknown-session';
  const turnId = input.turn_id || 'no-turn';
  const body = JSON.stringify({
    version: 1,
    eventId: `${sessionId}:${turnId}:${eventType}`.slice(0, 255),
    eventType,
    sessionId,
    turnId: input.turn_id,
    operator: operator(),
    ...context,
    content,
    occurredAt: new Date().toISOString(),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  try {
    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nen-timestamp': timestamp,
        'x-nen-signature': signature,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    result();
  } catch (error) {
    result(`Slack自動報告に失敗しました。作業内容は失われていません。${String(error)}`);
  }
}

if (process.argv[1]?.endsWith('codex-slack-hook.ts')) {
  readInput()
    .then(sendHookEvent)
    .catch((error) => result(`Slack自動報告フックの入力を処理できませんでした。${String(error)}`));
}
