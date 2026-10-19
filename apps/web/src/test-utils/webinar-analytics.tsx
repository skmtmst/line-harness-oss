import type { Webinar, WebinarAnalytics, WebinarEditor } from '@/lib/api'
import { AnalyticsPane } from '@/v8/webinar-edit/public/analytics/index'
import { webinarEditContext, webinarDetailChrome } from './webinar-edit'

export function webinarAnalytics(overrides: Partial<WebinarAnalytics> = {}): WebinarAnalytics {
  return {
    summary: { reservations: 0, viewers: 0, registeredAndJoined: 0, watched5m: 0, watched15m: 0, completed: 0, avgWatchedSeconds: 0, ctaClicks: 0, formSubmissions: 0 },
    sessions: [], daily: [], retention: { bucketSeconds: 60, started: 0, points: [] },
    ...overrides,
  } as WebinarAnalytics
}

/** 細部の試験も、製品が実際に描く分析の段から確認する。 */
export function WebinarAnalyticsPane({ analytics = webinarAnalytics(), id = 'webinar-1', durationSeconds = 1800 }: { analytics?: WebinarAnalytics; id?: string; durationSeconds?: number }) {
  return <AnalyticsPane ctx={webinarEditContext({ id, title: 'ウェビナー', durationSeconds } as Webinar, { version: 2 } as WebinarEditor, { analytics, analyticsState: 'ready' })} chrome={webinarDetailChrome} />
}
