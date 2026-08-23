import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

type GitHubUser = { login?: string | null };

export type GitHubPullRequest = {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  updated_at: string;
  user?: GitHubUser | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable_state?: string;
};

type GitHubPullRequestEvent = {
  action?: string;
  pull_request?: GitHubPullRequest;
};

type GitHubFile = { filename?: string };
type GitHubCheckRun = { status?: string; conclusion?: string | null };
type GitHubCheckRuns = { check_runs?: GitHubCheckRun[] };

export type PrSnapshot = {
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

export type RelayPayload = {
  version: 1;
  eventId: string;
  eventType: 'prompt_submitted' | 'turn_completed';
  sessionId: string;
  operator: 'kenta' | 'masato' | 'codex';
  repository: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  content: string;
  occurredAt: string;
  explicitCategory: 'fix';
  openPrs: PrSnapshot[];
  eventSource: 'github';
  syncMode: 'event' | 'reconcile';
  refreshCommandCenter: boolean;
};

type SyncOptions = {
  repository: string;
  githubToken: string;
  relayUrl: string;
  relaySecret: string;
  eventName?: string;
  event?: GitHubPullRequestEvent;
  minPrNumber: number;
  onlyPrNumber?: number;
  closedLookbackHours: number;
  now?: Date;
  fetcher?: typeof fetch;
};

const BASE_BRANCH = 'codex/development';
const MAX_OPEN_PRS = 30;
const MAX_RECENT_CLOSED_PRS = 100;
const IGNORED_OVERLAP_PREFIX = 'docs/release-log/';
const RELAY_TIMEOUT_MS = 20_000;

function assertRepository(value: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('GITHUB_REPOSITORY_INVALID');
  }
}

async function githubJson<T>(
  repository: string,
  path: string,
  token: string,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'line-harness-pr-slack-sync',
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GITHUB_API_FAILED:${response.status}`);
  return response.json() as Promise<T>;
}

export function summarizeChecks(checks: GitHubCheckRun[]): PrSnapshot['checks'] {
  if (checks.length === 0) return 'none';
  let pending = false;
  for (const check of checks) {
    const status = String(check.status || '').toUpperCase();
    const conclusion = String(check.conclusion || '').toUpperCase();
    if (['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE'].includes(conclusion)) return 'fail';
    if (status !== 'COMPLETED' || !conclusion) pending = true;
  }
  return pending ? 'pending' : 'pass';
}

function mergeState(value: string | undefined): string {
  const normalized = String(value || 'unknown').toUpperCase();
  if (['CLEAN', 'DIRTY', 'BLOCKED', 'BEHIND', 'UNSTABLE'].includes(normalized)) return normalized;
  return 'UNKNOWN';
}

async function openPrSnapshot(
  repository: string,
  pulls: GitHubPullRequest[],
  token: string,
  fetcher: typeof fetch,
): Promise<PrSnapshot[]> {
  const detailed: Array<{ snapshot: PrSnapshot; paths: string[] }> = [];
  // Keep GitHub API concurrency bounded. Each PR uses three parallel reads,
  // while PRs themselves are processed in order to avoid secondary limits.
  for (const pull of pulls.slice(0, MAX_OPEN_PRS)) {
    const [detail, files, checkRuns] = await Promise.all([
      githubJson<GitHubPullRequest>(repository, `/pulls/${pull.number}`, token, fetcher),
      githubJson<GitHubFile[]>(repository, `/pulls/${pull.number}/files?per_page=100`, token, fetcher),
      githubJson<GitHubCheckRuns>(repository, `/commits/${encodeURIComponent(pull.head.sha)}/check-runs?per_page=100`, token, fetcher),
    ]);
    const paths = files
      .flatMap((file) => typeof file.filename === 'string' ? [file.filename] : [])
      .filter((path) => !path.startsWith(IGNORED_OVERLAP_PREFIX));
    detailed.push({
      snapshot: {
        number: pull.number,
        title: pull.title.slice(0, 240),
        url: pull.html_url,
        author: pull.user?.login || 'unknown',
        headRefName: pull.head.ref.slice(0, 255),
        isDraft: pull.draft === true,
        mergeStateStatus: mergeState(detail.mergeable_state),
        updatedAt: pull.updated_at,
        fileCount: paths.length,
        overlapsWith: [] as number[],
        checks: summarizeChecks(checkRuns.check_runs || []),
      },
      paths,
    });
  }

  for (const current of detailed) {
    const paths = new Set(current.paths);
    current.snapshot.overlapsWith = detailed
      .filter((candidate) => candidate.snapshot.number !== current.snapshot.number)
      .filter((candidate) => candidate.paths.some((path) => paths.has(path)))
      .map((candidate) => candidate.snapshot.number)
      .sort((a, b) => a - b);
  }
  return detailed.map((item) => item.snapshot).sort((a, b) => a.number - b.number);
}

export function operatorForPull(pull: GitHubPullRequest): RelayPayload['operator'] {
  const author = (pull.user?.login || '').toLowerCase();
  if (author === 'skmtmst') return 'masato';
  if (author === 'kentavndng') return 'kenta';
  if (/(?:^|\/)masato(?:-|\/|$)/i.test(pull.head.ref)) return 'masato';
  if (/(?:^|\/)kenta(?:-|\/|$)/i.test(pull.head.ref)) return 'kenta';
  return 'codex';
}

function prState(pull: GitHubPullRequest): 'open' | 'merged' | 'closed' {
  if (pull.merged === true || pull.merged_at) return 'merged';
  return pull.state === 'closed' ? 'closed' : 'open';
}

function contentForPull(pull: GitHubPullRequest, action: string, mode: RelayPayload['syncMode']): string {
  const title = pull.title.replace(/\s+/g, ' ').trim().slice(0, 180);
  const state = prState(pull);
  if (state === 'merged') return `PR #${pull.number}「${title}」をマージし、対応が完了しました。`;
  if (state === 'closed') return `PR #${pull.number}「${title}」をクローズし、対応が完了しました。`;
  if (mode === 'reconcile') return `PR #${pull.number}「${title}」のSlack通知を再照合しました。`;
  const labels: Record<string, string> = {
    opened: '作成しました',
    reopened: '再開しました',
    synchronize: '更新しました',
    edited: '題名または説明を更新しました',
    ready_for_review: 'レビュー可能にしました',
    converted_to_draft: 'Draftへ戻しました',
  };
  return `PR #${pull.number}「${title}」を${labels[action] || '更新しました'}。`;
}

export function relayPayloadForPull(
  repository: string,
  pull: GitHubPullRequest,
  action: string,
  mode: RelayPayload['syncMode'],
  openPrs: PrSnapshot[],
  refreshCommandCenter = true,
): RelayPayload {
  const state = prState(pull);
  const stateToken = state === 'open' ? pull.head.sha : pull.merged_at || pull.updated_at;
  return {
    version: 1,
    eventId: `github-pr:${pull.number}:${mode}:${action}:${stateToken}`.slice(0, 255),
    eventType: state === 'open' ? 'prompt_submitted' : 'turn_completed',
    sessionId: `github-pr-${pull.number}`,
    operator: operatorForPull(pull),
    repository,
    branch: pull.head.ref,
    prNumber: pull.number,
    prUrl: pull.html_url,
    content: contentForPull(pull, action, mode),
    occurredAt: pull.updated_at,
    explicitCategory: 'fix',
    openPrs,
    eventSource: 'github',
    syncMode: mode,
    refreshCommandCenter,
  };
}

async function sendRelay(
  relayUrl: string,
  relaySecret: string,
  payload: RelayPayload,
  fetcher: typeof fetch,
): Promise<void> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', relaySecret).update(`${timestamp}.${body}`).digest('hex');
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(relayUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-nen-timestamp': timestamp,
          'x-nen-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
      if (response.ok) return;
      lastStatus = response.status;
      if (response.status < 500 || attempt === 3) break;
    } catch {
      if (attempt === 3) throw new Error('SLACK_RELAY_NETWORK_FAILED');
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw new Error(`SLACK_RELAY_FAILED:${lastStatus || 'network'}`);
}

export async function syncGitHubPullRequests(options: SyncOptions): Promise<{ sent: number; reconciled: number }> {
  assertRepository(options.repository);
  const fetcher = options.fetcher || fetch;
  const now = options.now || new Date();
  const openPulls = await githubJson<GitHubPullRequest[]>(
    options.repository,
    `/pulls?state=open&base=${encodeURIComponent(BASE_BRANCH)}&sort=created&direction=asc&per_page=${MAX_OPEN_PRS}`,
    options.githubToken,
    fetcher,
  );
  const openPrs = await openPrSnapshot(options.repository, openPulls, options.githubToken, fetcher);
  let sent = 0;

  const eventPull = options.eventName === 'pull_request' ? options.event?.pull_request : undefined;
  const eventAction = options.event?.action || 'updated';
  const closedPulls = await githubJson<GitHubPullRequest[]>(
    options.repository,
    `/pulls?state=closed&base=${encodeURIComponent(BASE_BRANCH)}&sort=updated&direction=desc&per_page=${MAX_RECENT_CLOSED_PRS}`,
    options.githubToken,
    fetcher,
  );
  const cutoff = now.getTime() - options.closedLookbackHours * 60 * 60 * 1_000;
  const candidates = [
    ...openPulls.filter((pull) => pull.number >= options.minPrNumber),
    ...closedPulls.filter((pull) => (
      pull.number >= options.minPrNumber && Date.parse(pull.updated_at) >= cutoff
    )),
  ].filter((pull) => options.onlyPrNumber === undefined || pull.number === options.onlyPrNumber);
  if (
    eventPull
    && eventPull.number >= options.minPrNumber
    && (options.onlyPrNumber === undefined || eventPull.number === options.onlyPrNumber)
    && eventPull.base.ref === BASE_BRANCH
  ) {
    await sendRelay(
      options.relayUrl,
      options.relaySecret,
      relayPayloadForPull(options.repository, eventPull, eventAction, 'event', openPrs, candidates.length === 0),
      fetcher,
    );
    sent += 1;
  }

  for (const [index, pull] of candidates.entries()) {
    await sendRelay(
      options.relayUrl,
      options.relaySecret,
      relayPayloadForPull(
        options.repository,
        pull,
        'reconcile',
        'reconcile',
        openPrs,
        index === candidates.length - 1,
      ),
      fetcher,
    );
  }
  return { sent, reconciled: candidates.length };
}

async function main(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const githubToken = process.env.GITHUB_TOKEN || '';
  const relayUrl = process.env.CODEX_SLACK_RELAY_URL || '';
  const relaySecret = process.env.CODEX_SLACK_RELAY_SECRET || '';
  const minPrNumber = Number(process.env.GITHUB_SLACK_SYNC_MIN_PR_NUMBER || '1');
  const onlyPrNumberRaw = process.env.GITHUB_SLACK_SYNC_ONLY_PR_NUMBER || '';
  const onlyPrNumber = onlyPrNumberRaw ? Number(onlyPrNumberRaw) : undefined;
  const closedLookbackHours = Number(process.env.GITHUB_SLACK_SYNC_CLOSED_LOOKBACK_HOURS || '72');
  if (!githubToken || !relayUrl || !relaySecret) throw new Error('GITHUB_SLACK_SYNC_NOT_CONFIGURED');
  if (!Number.isSafeInteger(minPrNumber) || minPrNumber < 1) throw new Error('GITHUB_SLACK_SYNC_MIN_PR_INVALID');
  if (onlyPrNumber !== undefined && (!Number.isSafeInteger(onlyPrNumber) || onlyPrNumber < minPrNumber)) {
    throw new Error('GITHUB_SLACK_SYNC_ONLY_PR_INVALID');
  }
  if (!Number.isFinite(closedLookbackHours) || closedLookbackHours < 1 || closedLookbackHours > 720) {
    throw new Error('GITHUB_SLACK_SYNC_LOOKBACK_INVALID');
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath
    ? JSON.parse(await readFile(eventPath, 'utf8')) as GitHubPullRequestEvent
    : undefined;
  const result = await syncGitHubPullRequests({
    repository,
    githubToken,
    relayUrl,
    relaySecret,
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    minPrNumber,
    onlyPrNumber,
    closedLookbackHours,
  });
  // Aggregate counts only. PR titles, tokens, signatures and payloads are not logged.
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ failedOperations: 1, reason: String(error).split(':')[0] }));
    process.exitCode = 1;
  });
}
