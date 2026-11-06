import type { ApiResponse, CompanySettings, CompanySettingsInput } from '@line-crm/shared';
import { fetchApi } from './api';

/** 共通の認証・CSRF・409処理を通して、会社単位の設定を読む／保存する。 */
export const companySettingsApi = {
  get: () => fetchApi<ApiResponse<CompanySettings>>('/api/settings/company'),
  update: (input: CompanySettingsInput) => fetchApi<ApiResponse<CompanySettings>>('/api/settings/company', {
    method: 'PUT', body: JSON.stringify(input),
  }),
};
