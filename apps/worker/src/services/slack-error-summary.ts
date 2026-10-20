export type HarnessErrorReport = {
  source: 'worker' | 'admin';
  incidentId?: string;
  message: string;
  path?: string;
  stack?: string;
  occurredAt?: string;
};

export function normalizedHarnessErrorPath(value: string | undefined): string {
  const raw = (value || '').replace(/\s+/g, ' ').trim().replace(/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/, '');
  let pathname: string;
  try {
    pathname = new URL(raw, 'https://invalid.local').pathname;
  } catch {
    return '/other';
  }
  // Copy only a fixed product area. IDs, hostnames, queries, hashes and arbitrary
  // path segments can contain customer data even when they resemble ordinary slugs.
  const parts = pathname.split('/').filter(Boolean);
  const api = parts[0] === 'api';
  const area = parts[api ? 1 : 0];
  const areas = ['friends', 'friend-add-settings', 'booking', 'forms', 'events', 'webinars',
    'scenarios', 'broadcasts', 'settings', 'dashboard', 'integrations', 'calendar', 'inbox',
    'chats', 'mileage', 'action-scores', 'restaurant-test', 'staff', 'auth', 'hq', 'ops'];
  return areas.includes(area) ? `${api ? '/api' : ''}/${area}` : '/other';
}

export function harnessErrorCode(report: HarnessErrorReport): string {
  if (report.source === 'worker' && report.message === 'unhandled_worker_error') return 'unhandled_worker_error';
  const status = report.message.match(/\b(?:api|http)(?:\s+error)?\s*:?\s*([45]\d{2})\b/i)?.[1];
  return status ? `HTTP ${status}` : 'runtime_error';
}

export function harnessErrorIncidentKey(report: HarnessErrorReport): string {
  const path = normalizedHarnessErrorPath(report.path);
  return `${report.source === 'worker' ? 'worker' : 'admin'}:${path}:${harnessErrorCode(report)}`;
}

/** S01の契約を保持。Workerが作ったUUID以外の自由な値は通知へ渡さない。 */
export function safeWorkerIncidentId(report: HarnessErrorReport): string | undefined {
  return report.source === 'worker' && typeof report.incidentId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(report.incidentId)
    ? report.incidentId : undefined;
}
