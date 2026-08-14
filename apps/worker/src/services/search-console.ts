const SEARCH_ANALYTICS_BASE = 'https://www.googleapis.com/webmasters/v3/sites';

export const SEARCH_CONSOLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export type SearchMetric = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchMetricRow = SearchMetric & { key: string };

export type SearchConsolePerformance = {
  siteUrl: string;
  startDate: string;
  endDate: string;
  rangeDays: number;
  summary: SearchMetric;
  previousSummary: SearchMetric;
  daily: SearchMetricRow[];
  queries: SearchMetricRow[];
  pages: SearchMetricRow[];
  devices: SearchMetricRow[];
  fetchedAt: string;
};

export class SearchConsoleApiError extends Error {
  constructor(readonly status: number) {
    super(`search_console_query_failed:${status}`);
    this.name = 'SearchConsoleApiError';
  }
}

type GoogleRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function metric(row?: GoogleRow): SearchMetric {
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0,
    position: row?.position ?? 0,
  };
}

function rows(value: { rows?: GoogleRow[] }): SearchMetricRow[] {
  return (value.rows ?? []).map((row) => ({ key: row.keys?.[0] ?? '', ...metric(row) }));
}

async function query(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<{ rows?: GoogleRow[] }> {
  const response = await fetch(`${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'web', ...body }),
  });
  if (!response.ok) {
    throw new SearchConsoleApiError(response.status);
  }
  return response.json<{ rows?: GoogleRow[] }>();
}

export async function getSearchConsolePerformance(input: {
  accessToken: string;
  siteUrl: string;
  rangeDays: number;
  now?: Date;
}): Promise<SearchConsolePerformance> {
  const end = addDays(input.now ?? new Date(), -1);
  const start = addDays(end, -(input.rangeDays - 1));
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(input.rangeDays - 1));
  const currentRange = { startDate: isoDate(start), endDate: isoDate(end) };
  const previousRange = { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) };

  const [summaryResult, previousResult, dailyResult, queryResult, pageResult, deviceResult] = await Promise.all([
    query(input.accessToken, input.siteUrl, currentRange),
    query(input.accessToken, input.siteUrl, previousRange),
    query(input.accessToken, input.siteUrl, { ...currentRange, dimensions: ['date'], rowLimit: 1000 }),
    query(input.accessToken, input.siteUrl, { ...currentRange, dimensions: ['query'], rowLimit: 10 }),
    query(input.accessToken, input.siteUrl, { ...currentRange, dimensions: ['page'], rowLimit: 10 }),
    query(input.accessToken, input.siteUrl, { ...currentRange, dimensions: ['device'], rowLimit: 10 }),
  ]);

  return {
    siteUrl: input.siteUrl,
    ...currentRange,
    rangeDays: input.rangeDays,
    summary: metric(summaryResult.rows?.[0]),
    previousSummary: metric(previousResult.rows?.[0]),
    daily: rows(dailyResult),
    queries: rows(queryResult),
    pages: rows(pageResult),
    devices: rows(deviceResult),
    fetchedAt: new Date().toISOString(),
  };
}
