/**
 * Uber Eats の接続先（ホスト）と、要求する権限の組。
 *
 * 公式仕様では、審査前の TEST APP（Sandbox）と審査後の PRODUCTION APP で接続先が分かれている。
 * 「トークンを取る先」と「APIを呼ぶ先」は必ず同じ側に揃える。混ぜると認証が落ちる。
 *
 *   |      | TEST APP（Sandbox）     | PRODUCTION APP |
 *   | 認証 | sandbox-login.uber.com | auth.uber.com  |
 *   | API  | test-api.uber.com      | api.uber.com   |
 *
 * 権限は Sandbox 側のホストに限り自動で付く。本番側は Uber の個別審査が要る。
 * Sandbox が通っても本番が通るとは限らない（公式の注意書き）。
 *
 * どちら側を使うかは配備の設定だけで決める。店舗が選べる値ではない。
 * 書き間違いは本番へ黙って出さず「設定されていない」として止める。
 */

/** 1組の接続先。認証とAPIを別々に差し替えられないよう、3つを必ず束で持つ。 */
export interface UberHosts {
  authorizeUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
}

/** 審査後の PRODUCTION APP 用。これまでの既定で、設定が無いときはこちら。 */
export const UBER_PRODUCTION_HOSTS: UberHosts = {
  authorizeUrl: 'https://auth.uber.com/oauth/v2/authorize',
  tokenUrl: 'https://auth.uber.com/oauth/v2/token',
  apiBaseUrl: 'https://api.uber.com',
};

/**
 * 審査前の TEST APP 用（Sandbox）。
 *
 * `tokenUrl` と `apiBaseUrl` は公式の Sandbox の手引きに載っている値。
 * `authorizeUrl` は同じ手引きに載っていないため、認証側のホストから組んだ推定値で、
 * まだ実際には確かめていない。最初の接続確認（client_credentials）は `tokenUrl`
 * だけを使うので、そこでは推定値を踏まない。
 */
export const UBER_SANDBOX_HOSTS: UberHosts = {
  authorizeUrl: 'https://sandbox-login.uber.com/oauth/v2/authorize',
  tokenUrl: 'https://sandbox-login.uber.com/oauth/v2/token',
  apiBaseUrl: 'https://test-api.uber.com',
};

/** 認可画面で店舗の人に許してもらう権限（店舗一覧の取得と連携の有効化だけに使う）。 */
export const UBER_PROVISIONING_SCOPES = ['eats.pos_provisioning'] as const;

/** 連携済みの店舗を動かすための権限。認可画面側の権限とは混ぜない。 */
export const UBER_OPERATION_SCOPES = [
  'eats.store',
  'eats.store.status.write',
  'eats.order',
  'eats.store.orders.read',
] as const;

/** 接続先を決める配備の設定。省略は本番で、これまでの動きを変えない。 */
export interface UberHostEnv {
  /** 'sandbox' のときだけ TEST APP 側へ向ける。未設定・'production' は本番。 */
  RT_DELIVERY_UBEREATS_ENVIRONMENT?: string;
}

/**
 * 配備の設定から接続先を1組選ぶ。
 *
 * 書き間違い（想定外の文字列）は本番へ落とさず null を返す。呼び出し側はこれを
 * 「連携の設定ができていない」として扱う。黙って本番の店舗へ出てしまうより、
 * つなげないことで配備の誤りに気づける方が安全。
 */
export function uberHosts(env: UberHostEnv): UberHosts | null {
  const value = env.RT_DELIVERY_UBEREATS_ENVIRONMENT?.trim().toLowerCase();
  if (!value || value === 'production') return UBER_PRODUCTION_HOSTS;
  if (value === 'sandbox') return UBER_SANDBOX_HOSTS;
  return null;
}
