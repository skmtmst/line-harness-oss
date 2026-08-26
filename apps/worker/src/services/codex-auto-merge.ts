import type { Env } from '../index.js';
import { decodeSlackTextEntities } from './slack-text.js';

const AUDIT_MARKER = '[claude->codex]';
const AUDIT_LINE_PATTERN = /^【監査結果】PR #(\d+) HEAD ([0-9a-f]{40}) 合格・統合可$/i;
const EXPECTED_REPOSITORY = 'skmtmst/line-harness-oss';
const TARGET_BRANCH = 'codex/development';
const REQUIRED_GATE_NAME = 'required-pr-gate';
const REFERENCE_ONLY_CHECKS = new Set(['sync']);
const AUTO_MERGE_EXCLUSION_LABEL = 'codex-auto-merge-excluded';
const LEDGER_MARKER = '<!-- codex-auto-merge-ledger:v1 -->';
const MAX_GITHUB_PAGES = 30;

type SlackMessage = {
  ts?: string;
  metadata?: {
    event_type?: string;
    event_payload?: Record<string, unknown>;
  };
};

type GitHubPullRequest = {
  number: number;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state?: string;
  title: string;
  html_url: string;
  base: { ref: string; sha: string };
  head: { sha: string };
  labels?: Array<{ name?: string }>;
};

type GitHubPullRequestFile = {
  filename: string;
  patch?: string;
};

type GitHubCheckRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
};

type GitHubCommitStatus = {
  id: number;
  context: string;
  state: string;
};

type GitHubIssueComment = {
  body?: string;
};

export type CodexAutoMergeMessage = {
  kind: 'auto_merge';
  slackEventId: string;
  channelId: string;
  threadTs: string;
  requesterUserId: string;
  prNumber: number;
  approvedHeadSha: string;
};

export type PullRequestBlockReason =
  | 'migration'
  | 'protected_file'
  | 'environment_file'
  | 'secret_addition';

export type GitHubFailureDetails = {
  kind: 'api' | 'ledger';
  status: number;
  path: string;
};

export function githubFailureDetails(error: unknown): GitHubFailureDetails | null {
  const message = error instanceof Error ? error.message : '';
  const match = /^GITHUB_(API_FAILED|LEDGER_WRITE_FAILED):(\d{3}):(\/[^\s]*)$/.exec(message);
  if (!match) return null;
  return {
    kind: match[1] === 'LEDGER_WRITE_FAILED' ? 'ledger' : 'api',
    status: Number(match[2]),
    path: match[3],
  };
}

type GitHubResponse<T> = {
  response: Response;
  value: T;
};

export function parseCodexAuditApproval(text: string): { prNumber: number; headSha: string } | null {
  const lines = decodeSlackTextEntities(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0] !== AUDIT_MARKER) return null;
  const matches = lines
    .map((line) => AUDIT_LINE_PATTERN.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);
  if (matches.length !== 1) return null;
  const prNumber = Number(matches[0][1]);
  return Number.isSafeInteger(prNumber) && prNumber > 0
    ? { prNumber, headSha: matches[0][2].toLowerCase() }
    : null;
}

export function isCodexAutoMergeEnabled(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function addedPatchLines(patch: string | undefined): string[] {
  if (!patch) return [];
  return patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
}

function hasSecretAddition(file: GitHubPullRequestFile): boolean {
  const lines = addedPatchLines(file.patch);
  if (lines.length === 0) return false;
  const wranglerFile = /(^|\/)wrangler[^/]*\.toml$/i.test(file.filename);
  return lines.some((line) => {
    const value = line.slice(1);
    if (/\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/i.test(value)) return true;
    if (/\bwrangler\s+secret\s+(?:put|bulk)\b/i.test(value)) return true;
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)) return true;
    if (/\b(?:gh[opsu]_|github_pat_|xox[baprs]-|sk_(?:live|test)_)[A-Za-z0-9_-]{8,}/.test(value)) {
      return true;
    }
    if (!wranglerFile) return false;
    const assignment = /^\s*([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*)\s*=\s*["']([^"']+)["']/i.exec(value);
    if (!assignment) return false;
    return !/^(?:placeholder|replace-me|example|test|false|disabled|unset)$/i.test(assignment[2]);
  });
}

export function prohibitedPullRequestChange(
  files: GitHubPullRequestFile[],
): { reason: PullRequestBlockReason; filename: string } | null {
  for (const file of files) {
    const normalized = file.filename.replace(/^\.\//, '');
    const basename = normalized.split('/').at(-1) ?? normalized;
    if (normalized.startsWith('packages/db/migrations/')) {
      return { reason: 'migration', filename: normalized };
    }
    if (
      [
        'auth.ts',
        'tenant-scope.ts',
        'account-access.ts',
        'codex-auto-merge.ts',
        'codex-slack-events.ts',
        'codex-cloud-monitor.ts',
        'slack-text.ts',
      ].includes(basename) || /^wrangler[^/]*\.toml$/i.test(basename)
    ) {
      return { reason: 'protected_file', filename: normalized };
    }
    if (
      basename === '.env' || basename.startsWith('.env.') ||
      basename === '.dev.vars' || basename.startsWith('.dev.vars.')
    ) {
      return { reason: 'environment_file', filename: normalized };
    }
    if (hasSecretAddition(file)) {
      return { reason: 'secret_addition', filename: normalized };
    }
  }
  return null;
}

function latestCheckRuns(checkRuns: GitHubCheckRun[]): GitHubCheckRun[] {
  const latest = new Map<string, GitHubCheckRun>();
  for (const run of checkRuns) {
    const current = latest.get(run.name);
    if (!current || run.id > current.id) latest.set(run.name, run);
  }
  return [...latest.values()];
}

export function requiredChecksBlockReason(checkRuns: GitHubCheckRun[]): string | null {
  const relevant = latestCheckRuns(checkRuns)
    .filter((run) => !REFERENCE_ONLY_CHECKS.has(run.name));
  const requiredGate = relevant.find((run) => run.name === REQUIRED_GATE_NAME);
  if (!requiredGate) return `${REQUIRED_GATE_NAME} がありません`;
  const pending = relevant.find((run) => run.status !== 'completed');
  if (pending) return `${pending.name} が未完了です`;
  const failed = relevant.find((run) => !['success', 'neutral', 'skipped'].includes(run.conclusion ?? ''));
  if (failed) return `${failed.name} が失敗しています`;
  return null;
}

export function commitStatusesBlockReason(statuses: GitHubCommitStatus[]): string | null {
  const latest = new Map<string, GitHubCommitStatus>();
  for (const status of statuses) {
    const current = latest.get(status.context);
    if (!current || status.id > current.id) latest.set(status.context, status);
  }
  for (const status of latest.values()) {
    if (REFERENCE_ONLY_CHECKS.has(status.context)) continue;
    if (status.state === 'pending') return `${status.context} が未完了です`;
    if (status.state !== 'success') return `${status.context} が失敗しています`;
  }
  return null;
}

async function slackApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const result = await response.json<T & { ok?: boolean; error?: string }>();
  if (!response.ok || result.ok !== true) {
    throw new Error(`SLACK_API_FAILED:${method}:${result.error ?? response.status}`);
  }
  return result;
}

async function postSlackResult(
  env: Env['Bindings'],
  message: CodexAutoMergeMessage,
  text: string,
  fetcher: typeof fetch,
): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN_NOT_CONFIGURED');
  await slackApi(env.SLACK_BOT_TOKEN, 'chat.postMessage', {
    channel: message.channelId,
    thread_ts: message.threadTs,
    text,
    client_msg_id: `${message.slackEventId}:auto-merge-result`,
  }, fetcher);
}

async function readThreadPrNumber(
  env: Env['Bindings'],
  message: CodexAutoMergeMessage,
  fetcher: typeof fetch,
): Promise<number | null> {
  if (!env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN_NOT_CONFIGURED');
  const result = await slackApi<{ ok: true; messages?: SlackMessage[] }>(
    env.SLACK_BOT_TOKEN,
    'conversations.history',
    {
      channel: message.channelId,
      oldest: message.threadTs,
      latest: message.threadTs,
      inclusive: true,
      limit: 1,
      include_all_metadata: true,
    },
    fetcher,
  );
  const parent = result.messages?.find((item) => item.ts === message.threadTs) ?? result.messages?.[0];
  if (parent?.metadata?.event_type !== 'line_harness_codex') return null;
  const workKey = parent.metadata.event_payload?.work_key;
  if (typeof workKey !== 'string') return null;
  const match = /^pr:(\d+)$/.exec(workKey);
  return match ? Number(match[1]) : null;
}

async function githubApi<T>(
  token: string,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<GitHubResponse<T>> {
  const response = await fetcher(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'line-harness-codex-auto-merge',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  const value = await response.json<T>();
  return { response, value };
}

async function githubJson<T>(
  token: string,
  path: string,
  fetcher: typeof fetch,
): Promise<T> {
  const result = await githubApi<T>(token, path, { method: 'GET' }, fetcher);
  if (!result.response.ok) throw new Error(`GITHUB_API_FAILED:${result.response.status}:${path}`);
  return result.value;
}

async function githubPages<T>(
  token: string,
  path: string,
  fetcher: typeof fetch,
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const items = await githubJson<T[]>(token, `${path}${separator}per_page=100&page=${page}`, fetcher);
    result.push(...items);
    if (items.length < 100) return result;
  }
  throw new Error(`GITHUB_API_PAGE_LIMIT:${path}`);
}

async function githubCheckRuns(
  token: string,
  repositoryPath: string,
  sha: string,
  fetcher: typeof fetch,
): Promise<GitHubCheckRun[]> {
  const result: GitHubCheckRun[] = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const response = await githubJson<{ check_runs: GitHubCheckRun[] }>(
      token,
      `${repositoryPath}/commits/${sha}/check-runs?per_page=100&page=${page}`,
      fetcher,
    );
    result.push(...response.check_runs);
    if (response.check_runs.length < 100) return result;
  }
  throw new Error(`GITHUB_API_PAGE_LIMIT:${repositoryPath}/commits/${sha}/check-runs`);
}

async function githubVerificationBlockReason(
  token: string,
  repositoryPath: string,
  sha: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const [checkRuns, combinedStatus] = await Promise.all([
    githubCheckRuns(token, repositoryPath, sha, fetcher),
    githubJson<{ statuses: GitHubCommitStatus[] }>(
      token,
      `${repositoryPath}/commits/${sha}/status`,
      fetcher,
    ),
  ]);
  return requiredChecksBlockReason(checkRuns) ??
    commitStatusesBlockReason(combinedStatus.statuses);
}

function blockMessage(prNumber: number, reason: string): string {
  return `【自動マージ停止】PR #${prNumber} はマージしていません。理由: ${reason}`;
}

function prohibitedReasonText(blocked: { reason: PullRequestBlockReason; filename: string }): string {
  const labels: Record<PullRequestBlockReason, string> = {
    migration: 'DBマイグレーションが含まれます',
    protected_file: '人がマージする保護対象ファイル（認証・テナント境界または自動マージの仕組み自体）が含まれます',
    environment_file: '環境設定ファイルが含まれます',
    secret_addition: '秘密値またはsecret追加の疑いがある差分を検知しました',
  };
  return `${labels[blocked.reason]} (${blocked.filename})`;
}

export async function processCodexAutoMerge(
  env: Env['Bindings'],
  message: CodexAutoMergeMessage,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) {
    console.error('Codex auto-merge stopped: SLACK_BOT_TOKEN is not configured');
    return;
  }

  const threadPrNumber = await readThreadPrNumber(env, message, fetcher);
  if (threadPrNumber !== null && threadPrNumber !== message.prNumber) {
    const reason = `合図のPR番号がスレッド対象のPR #${threadPrNumber} と一致しません`;
    await postSlackResult(env, message, blockMessage(message.prNumber, reason), fetcher);
    return;
  }

  if (!isCodexAutoMergeEnabled(env.CODEX_AUTO_MERGE_ENABLED)) {
    await postSlackResult(
      env,
      message,
      `【自動マージ検知のみ】PR #${message.prNumber} の監査合格合図を検知しました。CODEX_AUTO_MERGE_ENABLED が未設定または false のため、マージしていません。`,
      fetcher,
    );
    return;
  }

  if (env.CODEX_AUTO_MERGE_REPOSITORY !== EXPECTED_REPOSITORY) {
    await postSlackResult(env, message, blockMessage(message.prNumber, '対象リポジトリ設定が一致しません'), fetcher);
    return;
  }
  const token = env.CODEX_AUTO_MERGE_GITHUB_TOKEN;
  if (!token) {
    await postSlackResult(env, message, blockMessage(message.prNumber, 'GitHubマージ用secretが未設定です'), fetcher);
    return;
  }

  try {
    await processCodexAutoMergeWithGitHub(env, message, token, fetcher);
  } catch (error) {
    const failure = githubFailureDetails(error);
    if (!failure) throw error;
    console.error(JSON.stringify({
      event: 'codex_auto_merge_github_failed',
      status: failure.status,
      path: failure.path,
      ledgerWrite: failure.kind === 'ledger',
    }));
    const reason = failure.kind === 'ledger'
      ? `マージ済みですが台帳に記録できませんでした。二重マージ防止の記録がないため、人が確認してください (${failure.status} ${failure.path})`
      : `GitHub APIが失敗しました (${failure.status} ${failure.path})`;
    await postSlackResult(env, message, failure.kind === 'ledger'
      ? `【自動マージ要確認】PR #${message.prNumber} は${reason}`
      : blockMessage(message.prNumber, reason), fetcher);
  }
}

async function processCodexAutoMergeWithGitHub(
  env: Env['Bindings'],
  message: CodexAutoMergeMessage,
  token: string,
  fetcher: typeof fetch,
): Promise<void> {
  const repoPath = `/repos/${EXPECTED_REPOSITORY}`;
  const prPath = `${repoPath}/pulls/${message.prNumber}`;
  const pullRequest = await githubJson<GitHubPullRequest>(token, prPath, fetcher);
  if (pullRequest.number !== message.prNumber || pullRequest.base.ref !== TARGET_BRANCH) {
    await postSlackResult(env, message, blockMessage(message.prNumber, `向き先が ${TARGET_BRANCH} ではありません`), fetcher);
    return;
  }
  if (pullRequest.head.sha.toLowerCase() !== message.approvedHeadSha.toLowerCase()) {
    await postSlackResult(
      env,
      message,
      blockMessage(message.prNumber, 'Claude監査後にPRの差分が変わったため、現在のHEADを再監査してください'),
      fetcher,
    );
    return;
  }
  const comments = await githubPages<GitHubIssueComment>(
    token,
    `${repoPath}/issues/${message.prNumber}/comments`,
    fetcher,
  );
  const ledgerComment = comments.find((comment) => comment.body?.includes(LEDGER_MARKER));
  if (ledgerComment) {
    const sameEvent = ledgerComment.body?.includes(`Slack event: \`${message.slackEventId}\``);
    await postSlackResult(
      env,
      message,
      sameEvent
        ? `【自動マージ処理済み】PR #${message.prNumber} は同じSlack合図で台帳記録済みです。再マージは行っていません。`
        : blockMessage(message.prNumber, '台帳にマージ済みの記録があります'),
      fetcher,
    );
    return;
  }
  if (pullRequest.merged) {
    const recoveredLedger = await githubApi<GitHubIssueComment>(
      token,
      `${repoPath}/issues/${message.prNumber}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: `${LEDGER_MARKER}\nGitHubで既にマージ済みの状態を台帳へ記録しました。再マージは行っていません。\nSlack event: \`${message.slackEventId}\``,
        }),
      },
      fetcher,
    );
    if (!recoveredLedger.response.ok) {
      throw new Error(`GITHUB_LEDGER_WRITE_FAILED:${recoveredLedger.response.status}:${repoPath}/issues/${message.prNumber}/comments`);
    }
    await postSlackResult(env, message, blockMessage(message.prNumber, 'GitHubで既にマージ済みです。再マージせず台帳へ記録しました'), fetcher);
    return;
  }
  if (pullRequest.state !== 'open') {
    await postSlackResult(env, message, blockMessage(message.prNumber, 'PRはクローズ済みです'), fetcher);
    return;
  }
  if (pullRequest.draft) {
    await postSlackResult(env, message, blockMessage(message.prNumber, 'draft PRです'), fetcher);
    return;
  }
  if (pullRequest.labels?.some((label) => label.name === AUTO_MERGE_EXCLUSION_LABEL)) {
    await postSlackResult(env, message, blockMessage(message.prNumber, `${AUTO_MERGE_EXCLUSION_LABEL} ラベルで自動対象外です`), fetcher);
    return;
  }

  const files = await githubPages<GitHubPullRequestFile>(token, `${prPath}/files`, fetcher);
  const prohibited = prohibitedPullRequestChange(files);
  if (prohibited) {
    await postSlackResult(env, message, blockMessage(message.prNumber, prohibitedReasonText(prohibited)), fetcher);
    return;
  }

  const checksReason = await githubVerificationBlockReason(
    token,
    repoPath,
    pullRequest.head.sha,
    fetcher,
  );
  if (checksReason) {
    await postSlackResult(env, message, blockMessage(message.prNumber, checksReason), fetcher);
    return;
  }
  if (
    pullRequest.mergeable !== true ||
    !['clean', 'unstable'].includes(pullRequest.mergeable_state ?? '')
  ) {
    const reason = pullRequest.mergeable === null
      ? 'GitHubの競合判定が未完了です'
      : `PRを安全にマージできません (${pullRequest.mergeable_state ?? 'unknown'})`;
    await postSlackResult(env, message, blockMessage(message.prNumber, reason), fetcher);
    return;
  }

  const latest = await githubJson<GitHubPullRequest>(token, prPath, fetcher);
  if (
    latest.base.ref !== TARGET_BRANCH || latest.head.sha !== pullRequest.head.sha ||
    latest.base.sha !== pullRequest.base.sha || latest.state !== 'open' || latest.draft ||
    latest.mergeable !== true || !['clean', 'unstable'].includes(latest.mergeable_state ?? '')
  ) {
    await postSlackResult(env, message, blockMessage(message.prNumber, '直前確認でPRの向き先・差分・状態が変わりました'), fetcher);
    return;
  }
  const latestChecksReason = await githubVerificationBlockReason(
    token,
    repoPath,
    latest.head.sha,
    fetcher,
  );
  if (latestChecksReason) {
    await postSlackResult(env, message, blockMessage(message.prNumber, latestChecksReason), fetcher);
    return;
  }

  const merged = await githubApi<{ merged?: boolean; message?: string; sha?: string }>(
    token,
    `${prPath}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: 'merge',
        sha: pullRequest.head.sha,
        commit_title: `Merge pull request #${message.prNumber} from audited Slack approval`,
      }),
    },
    fetcher,
  );
  if (!merged.response.ok || merged.value.merged !== true) {
    await postSlackResult(
      env,
      message,
      blockMessage(message.prNumber, `GitHubがマージを拒否しました (${merged.value.message ?? merged.response.status})`),
      fetcher,
    );
    return;
  }

  const ledger = await githubApi<GitHubIssueComment>(
    token,
    `${repoPath}/issues/${message.prNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({
        body: `${LEDGER_MARKER}\n監査合格合図に基づき codex/development へマージ済みです。\nSlack event: \`${message.slackEventId}\``,
      }),
    },
    fetcher,
  );
  if (!ledger.response.ok) {
    throw new Error(`GITHUB_LEDGER_WRITE_FAILED:${ledger.response.status}:${repoPath}/issues/${message.prNumber}/comments`);
  }
  await postSlackResult(
    env,
    message,
    `【自動マージ完了】PR #${message.prNumber} を ${TARGET_BRANCH} へマージし、台帳へ記録しました。`,
    fetcher,
  );
}
