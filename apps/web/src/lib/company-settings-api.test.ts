import { beforeEach, expect, test, vi } from 'vitest';
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', () => ({ fetchApi: transport.request }));
import { companySettingsApi } from './company-settings-api';

beforeEach(() => { transport.request.mockReset(); });
test('読み込みと保存が共通の認証・CSRF処理を通り、版と画像IDを渡す', async () => {
  const data = { companyName: '試験会社', loginDisplayName: '試験ログイン', logoMediaId: 'fixture-image',
    logoUrl: 'https://images.test/logo', logoBackgroundColor: '#ffffff', version: 2 };
  transport.request.mockResolvedValue({ success: true, data });
  expect(await companySettingsApi.get()).toEqual({ success: true, data });
  expect(transport.request).toHaveBeenLastCalledWith('/api/settings/company');
  const input = { companyName: data.companyName, loginDisplayName: data.loginDisplayName,
    logoMediaId: data.logoMediaId, logoBackgroundColor: data.logoBackgroundColor, expectedVersion: 1 };
  expect(await companySettingsApi.update(input)).toEqual({ success: true, data });
  expect(transport.request).toHaveBeenLastCalledWith('/api/settings/company', { method: 'PUT', body: JSON.stringify(input) });
});
test('共通処理の409を成功にせず呼び出し元へ返す', async () => {
  const conflict = Object.assign(new Error('最新版を読み直してください'), { status: 409, code: 'VERSION_CONFLICT' });
  transport.request.mockRejectedValue(conflict);
  const result = await companySettingsApi.update({ companyName: '試験会社', loginDisplayName: '試験ログイン',
    logoMediaId: null, logoBackgroundColor: '#ffffff', expectedVersion: 0 }).catch(error => error);
  expect(result).toBe(conflict);
});
