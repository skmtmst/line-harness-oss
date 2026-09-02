import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = {
  getGoogleServiceAccountToken: vi.fn(),
  getSearchConsolePerformance: vi.fn(),
};
vi.mock('../services/google-service-account.js', () => ({
  getGoogleServiceAccountToken: mocks.getGoogleServiceAccountToken,
}));
vi.mock('../services/search-console.js', () => ({
  SEARCH_CONSOLE_READONLY_SCOPE: 'https://www.googleapis.com/auth/webmasters.readonly',
  SearchConsoleApiError: class SearchConsoleApiError extends Error {
    constructor(readonly status: number) { super(`search_console_query_failed:${status}`); }
  },
  getSearchConsolePerformance: mocks.getSearchConsolePerformance,
}));

const { searchConsole } = await import('./search-console.js');
const app = new Hono();
app.route('/', searchConsole);

beforeEach(() => vi.clearAllMocks());

describe('GET /api/search-console/performance', () => {
  test('未設定時は秘密情報を要求せずセットアップ情報を返す', async () => {
    const response = await app.request('/api/search-console/performance', {}, {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reader@example.iam.gserviceaccount.com',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { status: 'not_configured', serviceAccountEmail: 'reader@example.iam.gserviceaccount.com' },
    });
    expect(mocks.getGoogleServiceAccountToken).not.toHaveBeenCalled();
  });

  test('90日を指定してread-only scopeで集計する', async () => {
    mocks.getGoogleServiceAccountToken.mockResolvedValue('token');
    mocks.getSearchConsolePerformance.mockResolvedValue({ summary: { clicks: 10 } });
    const env = {
      SEARCH_CONSOLE_SITE_URL: 'sc-domain:nen-petfood.com',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reader@example.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-key',
    };
    const response = await app.request('/api/search-console/performance?days=90', {}, env);
    expect(response.status).toBe(200);
    expect(mocks.getGoogleServiceAccountToken).toHaveBeenCalledWith(expect.objectContaining({
      email: 'reader@example.iam.gserviceaccount.com',
    }), 'https://www.googleapis.com/auth/webmasters.readonly');
    expect(mocks.getSearchConsolePerformance).toHaveBeenCalledWith({
      accessToken: 'token', siteUrl: 'sc-domain:nen-petfood.com', rangeDays: 90,
    });
  });

  test('権限不足は設定案内用コードに変換する', async () => {
    mocks.getGoogleServiceAccountToken.mockResolvedValue('token');
    const { SearchConsoleApiError } = await import('../services/search-console.js');
    mocks.getSearchConsolePerformance.mockRejectedValue(new SearchConsoleApiError(403));
    const response = await app.request('/api/search-console/performance', {}, {
      SEARCH_CONSOLE_SITE_URL: 'sc-domain:nen-petfood.com',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'reader@example.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-key',
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'SEARCH_CONSOLE_ACCESS_DENIED' });
  });
});
