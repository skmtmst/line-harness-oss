import { assertReleaseInputs } from './artifacts.js';
import { assertSha, command, requireValue } from './common.js';

export function assertReleaseSource(sha: string, main: string, actual: string, context: NodeJS.ProcessEnv, mainTreeAndAncestryVerified = false): void {
  assertSha(sha);
  if ((main !== sha && !mainTreeAndAncestryVerified) || actual !== sha || context.GITHUB_SHA !== main || context.GITHUB_REF !== 'refs/heads/main' || context.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('main_only');
  if (context.GITHUB_WORKFLOW_REF !== `${context.GITHUB_REPOSITORY}/.github/workflows/deploy-cloudflare-production.yml@refs/heads/main`) throw new Error('parent_only');
}
/** Publish only the exact staging-tested tree after main approves it.
 * A merge commit may have another SHA but must have the same tree. */
export function verifyReleaseCheckout(sha: string): void {
  assertSha(sha);
  if (command('git', ['status', '--porcelain', '--untracked-files=all']).trim()) throw new Error('dirty_checkout');
  command('git', ['fetch', '--no-tags', 'origin', 'main']);
  const main = command('git', ['rev-parse', 'FETCH_HEAD']).trim();
  command('git', ['merge-base', '--is-ancestor', sha, main]);
  const sameTree = command('git', ['rev-parse', `${sha}^{tree}`]).trim() === command('git', ['rev-parse', `${main}^{tree}`]).trim();
  if (!sameTree) throw new Error('main_tree_mismatch');
  assertReleaseSource(sha, main, command('git', ['rev-parse', 'HEAD']).trim(), process.env, true);
}
export function assertStagingRun(run: any, jobs: any, sha: string, repository: string): void {
  if (run?.repository?.full_name !== repository || run?.head_repository?.full_name !== repository || run?.path !== '.github/workflows/deploy-cloudflare-staging.yml' || run?.head_sha !== sha || !['codex/development', 'codex/masato-production-release-20261104'].includes(run?.head_branch) || run?.status !== 'completed' || run?.conclusion !== 'success' || run?.event !== 'workflow_dispatch') throw new Error('staging_run');
  const required = ['Deploy Worker to staging', 'Deploy Admin Panel to staging', 'Verify public source revisions'];
  if (!jobs?.jobs?.some((job: any) => job.name === 'deploy' && job.conclusion === 'success' && required.every(name => job.steps?.some((step: any) => step.name === name && step.conclusion === 'success')))) throw new Error('staging_public_verification');
}
/** GitHub Free cannot protect a private environment with required reviewers.
 * The owner must start (and, for a rerun, restart) this exact release workflow. */
export function assertProductionApproval(run: any, context: NodeJS.ProcessEnv, repository: string): void {
  if (context.GITHUB_ACTOR !== 'skmtmst' || context.GITHUB_TRIGGERING_ACTOR !== 'skmtmst' ||
      run?.actor?.login !== 'skmtmst' || run?.triggering_actor?.login !== 'skmtmst' ||
      String(run?.id) !== context.GITHUB_RUN_ID || run?.repository?.full_name !== repository ||
      run?.head_repository?.full_name !== repository || run?.head_sha !== context.GITHUB_SHA ||
      run?.head_branch !== 'main' || run?.event !== 'workflow_dispatch' ||
      run?.path !== '.github/workflows/deploy-cloudflare-production.yml') throw new Error('production_owner_dispatch');
}
export async function preflight(sha: string, runId: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (process.env.OPERATIONS_PAUSED !== 'true') throw new Error('operations_pause_confirmation');
  assertReleaseInputs();
  const repository = requireValue(process.env.GITHUB_REPOSITORY);
  verifyReleaseCheckout(sha);
  if (!/^\d+$/.test(runId)) throw new Error('staging_run_id');
  const get = async (path: string) => {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${requireValue(process.env.GH_TOKEN)}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('github_metadata');
    return response.json();
  };
  const ownRunId = requireValue(process.env.GITHUB_RUN_ID);
  if (!/^\d+$/.test(ownRunId)) throw new Error('production_run_id');
  assertProductionApproval(await get(`actions/runs/${ownRunId}`), process.env, repository);
  assertStagingRun(await get(`actions/runs/${runId}`), await get(`actions/runs/${runId}/jobs?filter=latest&per_page=100`), sha, repository);
  // The immutable staging run above verified both public revisions when it
  // published this SHA. Later staging deployments must not invalidate that
  // release proof or require replacing another developer's current build.
}
