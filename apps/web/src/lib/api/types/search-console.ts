export type SearchConsoleMetric = {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type SearchConsoleMetricRow = SearchConsoleMetric & { key: string }

export type SearchConsolePerformance = {
  status: 'connected'
  siteUrl: string
  startDate: string
  endDate: string
  rangeDays: number
  summary: SearchConsoleMetric
  previousSummary: SearchConsoleMetric
  daily: SearchConsoleMetricRow[]
  queries: SearchConsoleMetricRow[]
  pages: SearchConsoleMetricRow[]
  devices: SearchConsoleMetricRow[]
  fetchedAt: string
}

export type SearchConsoleSetup = {
  status: 'not_configured'
  siteUrl: string | null
  serviceAccountEmail: string | null
}
