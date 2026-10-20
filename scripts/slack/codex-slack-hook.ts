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
  openPrs?: CodexSlackPrSnapshot[];
};

export type CodexSlackPrSnapshot = {
  number: number;
  title: string;
  url: string;
  author: string;
  headRefName: string;
  isDraft: boolean;
  mergeStateStatus: string;
  updatedAt: string;
  fileCount: number;
  overlapsWith: number[];
  checks: 'pass' | 'pending' | 'fail' | 'none';
};

export const CODEX_SLACK_RELAY_TIMEOUT_MS = 20_000;
export const DEFAULT_CODEX_SLACK_RELAY_URL =
  'https://nen-line-stg.skmtmst.workers.dev/api/integrations/codex-slack/events';
const CODEX_SLACK_KEYCHAIN_SERVICE = 'line-harness-codex-slack-relay';

function run(command: string, args: string[], cwd: string, timeout = 3_000): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
    }).trim() || null;
  } catch {
    return null;
  }
}

function checkSummary(value: unknown): CodexSlackPrSnapshot['checks'] {
  if (!Array.isArray(value) || value.length === 0) return 'none';
  let pending = false;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const check = item as Record<string, unknown>;
    const state = String(check.conclusion || check.state || '').toUpperCase();
    const status = String(check.status || '').toUpperCase();
    if (['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state)) return 'fail';
    if ((!state && status && status !== 'COMPLETED') || ['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED'].includes(state)) {
      pending = true;
    }
  }
  return pending ? 'pending' : 'pass';
}

export function parseOpenPrSnapshot(raw: string | null): CodexSlackPrSnapshot[] | undefined {
  if (!raw) return undefined;
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) return undefined;
    const parsed = rows.slice(0, 30).flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const row = value as Record<string, unknown>;
      if (!Number.isInteger(row.number) || Number(row.number) < 1 || typeof row.title !== 'string') return [];
      const files = Array.isArray(row.files)
        ? row.files.flatMap((file) => {
          if (!file || typeof file !== 'object') return [];
          const path = (file as Record<string, unknown>).path;
          return typeof path === 'string' && !path.startsWith('docs/release-log/') ? [path] : [];
        })
        : [];
      return [{
        number: Number(row.number),
        title: row.title.slice(0, 240),
        url: typeof row.url === 'string' ? row.url.slice(0, 500) : '',
        author: row.author && typeof row.author === 'object' && typeof (row.author as Record<string, unknown>).login === 'string'
          ? String((row.author as Record<string, unknown>).login).slice(0, 100)
          : 'unknown',
        headRefName: typeof row.headRefName === 'string' ? row.headRefName.slice(0, 255) : '',
        isDraft: row.isDraft === true,
        mergeStateStatus: typeof row.mergeStateStatus === 'string' ? row.mergeStateStatus.slice(0, 30) : 'UNKNOWN',
        updatedAt: typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt))
          ? row.updatedAt
          : new Date(0).toISOString(),
        fileCount: files.length,
        overlapsWith: [] as number[],
        checks: checkSummary(row.statusCheckRollup),
        _files: files,
      }];
    });
    for (const current of parsed) {
      const paths = new Set(current._files);
      current.overlapsWith = parsed
        .filter((candidate) => candidate.number !== current.number && candidate._files.some((path) => paths.has(path)))
        .map((candidate) => candidate.number)
        .sort((a, b) => a - b);
    }
    return parsed
      .sort((a, b) => a.number - b.number)
      .map(({ _files: _ignored, ...item }) => item);
  } catch {
    return undefined;
  }
}

export function repositoryFromRemote(remote: string | null): string | undefined {
  if (!remote) return undefined;
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return match?.[1];
}

export function repositoryRemoteName(branchRemote: string | null, hasFork: boolean): string {
  if (branchRemote && branchRemote !== '.') return branchRemote;
  return hasFork ? 'fork' : 'origin';
}

export function hookEventType(hookEventName: string | undefined): 'prompt_submitted' | 'turn_completed' | 'approval_required' | null {
  if (hookEventName === 'UserPromptSubmit') return 'prompt_submitted';
  if (hookEventName === 'Stop') return 'turn_completed';
  if (hookEventName === 'PermissionRequest') return 'approval_required';
  return null;
}

export function prNumberFromContent(content: string): number | undefined {
  const raw = content.match(/\bPR\s*#(\d+)\b/i)?.[1];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function configuredValue(name: string, cwd: string): string | undefined {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  if (process.platform !== 'darwin') return undefined;
  return run('/bin/launchctl', ['getenv', name], cwd) || undefined;
}

function keychainRelaySecret(operatorName: 'kenta' | 'masato' | 'codex', cwd: string): string | undefined {
  if (process.platform !== 'darwin' || operatorName === 'codex') return undefined;
  return run('/usr/bin/security', [
    'find-generic-password',
    '-s', CODEX_SLACK_KEYCHAIN_SERVICE,
    '-a', operatorName,
    '-w',
  ], cwd) || undefined;
}

function gitContext(cwd: string): GitContext {
  const branch = run('git', ['branch', '--show-current'], cwd) || undefined;
  const branchRemote = branch
    ? run('git', ['config', '--get', `branch.${branch}.remote`], cwd)
    : null;
  const remoteName = repositoryRemoteName(
    branchRemote,
    Boolean(run('git', ['remote', 'get-url', 'fork'], cwd)),
  );
  const repository = repositoryFromRemote(run('git', ['remote', 'get-url', remoteName], cwd));
  const pr = run('gh', ['pr', 'view', '--json', 'number,url', '--jq', '[.number,.url]|@tsv'], cwd);
  const [rawNumber, prUrl] = pr?.split('\t') || [];
  const prNumber = rawNumber && /^\d+$/.test(rawNumber) ? Number(rawNumber) : undefined;
  const openPrs = parseOpenPrSnapshot(run('gh', [
    'pr', 'list', '--base', 'codex/development', '--state', 'open', '--limit', '30',
    '--json', 'number,title,isDraft,mergeStateStatus,author,headRefName,url,updatedAt,files,statusCheckRollup',
  ], cwd, 8_000));
  return { repository, branch, prNumber, prUrl: prUrl || undefined, openPrs };
}

function contentFor(input: HookInput): string {
  if (input.hook_event_name === 'UserPromptSubmit') return input.prompt || '';
  if (input.hook_event_name === 'Stop') return input.last_assistant_message || '';
  if (input.hook_event_name === 'PermissionRequest') {
    return input.tool_input?.description || 'Codexが作業を続けるための承認を待っています。';
  }
  return '';
}

function operator(cwd: string): 'kenta' | 'masato' | 'codex' {
  const configured = (configuredValue('CODEX_OPERATOR', cwd) || '').toLowerCase();
  if (configured === 'kenta' || configured === 'masato' || configured === 'codex') return configured;
  const gitName = (run('git', ['config', 'user.name'], cwd) || '').toLowerCase();
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
  const cwd = input.cwd || process.cwd();
  const operatorName = operator(cwd);
  const relayUrl = configuredValue('CODEX_SLACK_RELAY_URL', cwd) || DEFAULT_CODEX_SLACK_RELAY_URL;
  const secret = configuredValue('CODEX_SLACK_RELAY_SECRET', cwd) || keychainRelaySecret(operatorName, cwd);
  const required = configuredValue('CODEX_SLACK_SYNC_REQUIRED', cwd) !== '0';
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
  const context = gitContext(cwd);
  const mentionedPrNumber = prNumberFromContent(content);
  if (!context.prNumber && mentionedPrNumber) {
    context.prNumber = mentionedPrNumber;
    if (context.repository) {
      context.prUrl = `https://github.com/${context.repository}/pull/${mentionedPrNumber}`;
    }
  }
  const sessionId = input.session_id || 'unknown-session';
  const turnId = input.turn_id || 'no-turn';
  const body = JSON.stringify({
    version: 1,
    eventId: `${sessionId}:${turnId}:${eventType}`.slice(0, 255),
    eventType,
    sessionId,
    turnId: input.turn_id,
    operator: operatorName,
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
      signal: AbortSignal.timeout(CODEX_SLACK_RELAY_TIMEOUT_MS),
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
