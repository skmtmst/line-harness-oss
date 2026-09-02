import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getGoogleServiceAccountToken } from '../services/google-service-account.js';
import {
  getSearchConsolePerformance,
  SearchConsoleApiError,
  SEARCH_CONSOLE_READONLY_SCOPE,
} from '../services/search-console.js';

export const searchConsole = new Hono<Env>();

searchConsole.get('/api/search-console/performance', async (c) => {
  const siteUrl = c.env.SEARCH_CONSOLE_SITE_URL?.trim();
  const serviceAccountEmail = c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || null;
  if (!siteUrl || !serviceAccountEmail || !c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    return c.json({
      success: true,
      data: {
        status: 'not_configured' as const,
        siteUrl: siteUrl || null,
        serviceAccountEmail,
      },
    });
  }

  const requestedRange = Number(c.req.query('days') ?? 28);
  const rangeDays = [7, 28, 90].includes(requestedRange) ? requestedRange : 28;

  try {
    const accessToken = await getGoogleServiceAccountToken({
      email: serviceAccountEmail,
      privateKey: c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    }, SEARCH_CONSOLE_READONLY_SCOPE);
    const performance = await getSearchConsolePerformance({ accessToken, siteUrl, rangeDays });
    return c.json({ success: true, data: { status: 'connected' as const, ...performance } });
  } catch (error) {
    console.error('GET /api/search-console/performance error:', error);
    const accessDenied = error instanceof SearchConsoleApiError && [401, 403].includes(error.status);
    return c.json({
      success: false,
      error: accessDenied
        ? 'Search Consoleの閲覧権限を確認してください'
        : 'Search Consoleデータを取得できませんでした',
      code: accessDenied ? 'SEARCH_CONSOLE_ACCESS_DENIED' : 'SEARCH_CONSOLE_FETCH_FAILED',
      setup: { siteUrl, serviceAccountEmail },
    }, 502);
  }
});
