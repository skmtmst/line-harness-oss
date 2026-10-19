import { assertReleaseInputs } from './artifacts.js';
import { assertSha, command, requireValue } from './common.js';
// @ts-expect-error Existing read-only JS CLI
import { verifyPublicBuild } from '../verify-public-build.mjs';

export function assertReleaseSource(sha: string, main: string, actual: string, context: NodeJS.ProcessEnv, mainTreeAndAncestryVerified = false): void {
  assertSha(sha);
  if ((main !== sha && !mainTreeAndAncestryVerified) || actual !== sha || context.GITHUB_SHA !== main || context.GITHUB_REF !== 'refs/heads/main' || context.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('main_only');
  if (context.GITHUB_WORKFLOW_REF !== `${context.GITHUB_REPOSITORY}/.github/workflows/deploy-cloudflare-production.yml@refs/heads/main`) throw new Error('parent_only');
}
/** Staging is restricted to development. Publish its exact tested commit only
 * after main approves the identical tree (a merge commit may have another SHA). */
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
  if (run?.repository?.full_name !== repository || run?.head_repository?.full_name !== repository || run?.path !== '.github/workflows/deploy-cloudflare-staging.yml' || run?.head_sha !== sha || run?.status !== 'completed' || run?.conclusion !== 'success' || run?.event !== 'workflow_dispatch') throw new Error('staging_run');
  if (!jobs?.jobs?.some((job: any) => job.conclusion === 'success' && job.steps?.some((step: any) => step.name === 'Verify public source revisions' && step.conclusion === 'success'))) throw new Error('staging_public_verification');
}
export function assertProductionApproval(environment: any): void {
  if (!environment?.protection_rules?.some((rule: any) => rule.type === 'required_reviewers' && rule.reviewers?.length > 0)) throw new Error('production_reviewers');
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
  assertProductionApproval(await get('environments/production'));
  assertStagingRun(await get(`actions/runs/${runId}`), await get(`actions/runs/${runId}/jobs?filter=latest&per_page=100`), sha, repository);
  // A successful dry-run or config replay cannot substitute for this exact public revision.
  await verifyPublicBuild('https://stg-api.musubo.jp', sha, 'https://stg-admin.musubo.jp', sha, fetcher);
}
