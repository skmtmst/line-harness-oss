/**
 * 環境限定機能の安全側判定。
 *
 * 飲食店向け機能は検証専用であり、明示的に true の環境だけで動かす。
 * 値の欠落や打ち間違いを有効扱いにすると、本番デプロイ時にテスト機能が
 * 表へ出るため、既定値は必ず無効にする。
 */
export function restaurantTestEnabled(env: { RESTAURANT_TEST_ENABLED?: string; DEPLOY_ENV?: string }): boolean {
  // Missing, production and unknown environments stay closed even if the flag is true.
  const environment = env.DEPLOY_ENV?.trim().toLowerCase();
  if (environment !== 'staging' && environment !== 'development' && environment !== 'test') return false;
  return env.RESTAURANT_TEST_ENABLED?.trim().toLowerCase() === 'true';
}
