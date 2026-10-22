import type { CfApiCreds } from '../types.js';
import { authHeader, workersApiBase } from './shared.js';
const PREFIX = 'worker-deployment:';
type Version = { version_id: string; percentage: number };
function validVersions(value: unknown): value is Version[] {
  return Array.isArray(value) && value.length > 0 && value.every(v => typeof v.version_id === 'string'
    && /^[a-f0-9-]{36}$/i.test(v.version_id) && Number.isFinite(v.percentage) && v.percentage > 0 && v.percentage <= 100)
    && Math.abs(value.reduce((n, v) => n + v.percentage, 0) - 100) < 0.001;
}
export function isWorkerDeploymentSnapshot(value: string): boolean { return value.startsWith(PREFIX); }
/** Version references include both code and assets, unlike a script-content snapshot. */
export async function snapshotWorkerDeployment(creds: CfApiCreds, scriptName: string): Promise<string> {
  const response = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}/deployments`, { headers: authHeader(creds.apiToken) });
  if (!response.ok) throw new Error(`worker_deployment_snapshot: HTTP ${response.status}`);
  const body = await response.json() as { success: boolean; result: { deployments: { versions: Version[] }[] } };
  const versions = body.result?.deployments?.[0]?.versions;
  if (!body.success || !validVersions(versions)) throw new Error('worker_deployment_snapshot_invalid');
  return PREFIX + JSON.stringify(versions.map(({ version_id, percentage }) => ({ version_id, percentage })));
}
export async function restoreWorkerDeployment(creds: CfApiCreds, scriptName: string, snapshot: string): Promise<void> {
  if (!isWorkerDeploymentSnapshot(snapshot)) throw new Error('worker_deployment_snapshot_invalid');
  const versions: unknown = JSON.parse(snapshot.slice(PREFIX.length));
  if (!validVersions(versions)) throw new Error('worker_deployment_snapshot_invalid');
  const response = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}/deployments`, {
    method: 'POST', headers: { ...authHeader(creds.apiToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategy: 'percentage', versions }),
  });
  if (!response.ok || !(await response.json() as { success: boolean }).success) throw new Error('worker_deployment_restore_failed');
}
