import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function requireValue(value: string | undefined): string {
  if (!value) throw new Error('required_value');
  return value;
}
export function assertSha(sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('release_sha');
}
/** Never forward provider stderr/stdout into public Actions logs. */
export function command(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('command_failed');
  return result.stdout;
}
export async function cloudflare(path: string, fetcher: typeof fetch = fetch): Promise<any> {
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(requireValue(process.env.CLOUDFLARE_ACCOUNT_ID))}/${path}`, {
    headers: { Authorization: `Bearer ${requireValue(process.env.CLOUDFLARE_API_TOKEN)}` },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('cloudflare_metadata');
  const body = await response.json() as { success: boolean; result: unknown };
  if (body.success !== true || !body.result) throw new Error('cloudflare_metadata');
  return body.result;
}
export function result(check: string, pass: boolean): void {
  const line = `${check}: ${pass ? 'PASS' : 'FAIL'}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}
