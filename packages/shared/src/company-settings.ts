/** 会社単位の表示設定。版は保存のたびに1増える。 */
export interface CompanySettings {
  companyName: string;
  loginDisplayName: string;
  logoMediaId: string | null;
  logoUrl: string | null;
  logoBackgroundColor: string;
  version: number;
}

export interface CompanySettingsInput {
  companyName: string;
  loginDisplayName: string;
  logoMediaId: string | null;
  logoBackgroundColor: string;
  expectedVersion: number;
}
