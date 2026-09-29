/**
 * 広告費の毎日取り込み (#818)。
 *
 * 外部連携(ad_platforms)に暗号化して保管した秘密を復号し、媒体の
 * レポートAPIから「その日に使った費用」を取って ad_cost_entries へ
 * 載せる。取れた・取れなかったは ad_cost_import_runs に日ごとで残す。
 * 取れない日は費用欄が「—」になり、最後に取れた日時は台帳が持つ。
 *
 * 同じ日を取り直しても行が増えないよう、台帳側は upsert、
 * 実行台帳は媒体×日の一意制約で冪等になっている。
 */
import {
  getAdPlatforms,
  getAdPlatformById,
  hasSuccessfulAdCostImport,
  recordAdCostImportRun,
  resolveAdPlatformConfig,
  upsertAdCostEntry,
  type AdPlatform,
  type AdPlatformConfig,
} from '@line-crm/db';
import { buildXOAuth1Header } from './ad-conversion.js';
import { GOOGLE_ADS_API_VERSION } from './ad-conversion.js';

/** 小数点以下を持たない通貨。この中の通貨は 最小通貨単位 = 表示単位。 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

/** 媒体が返す表示単位の金額 → 最小通貨単位 */
function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDecimals(currency));
}

/** 媒体が返すマイクロ単位(1/1,000,000)の金額 → 最小通貨単位 */
function microsToMinorUnits(micros: number, currency: string): number {
  const decimals = currencyDecimals(currency);
  return Math.round(micros / 10 ** (6 - decimals));
}

function configCurrency(config: AdPlatformConfig): string {
  const value = config.currency;
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : 'JPY';
}

/** 設定が費用取込に足りているか。足りないキー名を返す(揃っていれば null)。 */
function missingConfigKey(platform: AdPlatform, config: AdPlatformConfig): string | null {
  const need: Record<string, string[]> = {
    meta: ['ad_account_id', 'access_token'],
    x: ['account_id', 'api_key', 'api_secret'],
    google: ['customer_id', 'oauth_token', 'developer_token'],
    tiktok: ['advertiser_id', 'access_token'],
  };
  for (const key of need[platform.name] ?? []) {
    const value = (config as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !value) return key;
  }
  return need[platform.name] ? null : `不明な媒体です: ${platform.name}`;
}

interface FetchedCost {
  amountMinor: number;
  currency: string;
}

async function fetchMetaCost(config: AdPlatformConfig, day: string): Promise<FetchedCost> {
  const currency = configCurrency(config);
  const accountId = String(config.ad_account_id).replace(/^act_/, '');
  const timeRange = encodeURIComponent(JSON.stringify({ since: day, until: day }));
  const url = `https://graph.facebook.com/v21.0/act_${accountId}/insights`
    + `?fields=spend&level=account&time_range=${timeRange}`
    + `&access_token=${encodeURIComponent(String(config.access_token))}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Meta API error: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json() as { data?: Array<{ spend?: string }> };
  const spend = Number(payload.data?.[0]?.spend ?? 0);
  if (!Number.isFinite(spend)) throw new Error('Meta API の応答に費用がありません');
  return { amountMinor: toMinorUnits(spend, currency), currency };
}

async function fetchGoogleCost(config: AdPlatformConfig, day: string): Promise<FetchedCost> {
  const customerId = String(config.customer_id).replace(/-/g, '');
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`
    + `/customers/${encodeURIComponent(customerId)}/googleAds:searchStream`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${String(config.oauth_token)}`,
      'developer-token': String(config.developer_token),
    },
    body: JSON.stringify({
      query: `SELECT customer.currency_code, metrics.cost_micros FROM customer`
        + ` WHERE segments.date = '${day}'`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google Ads API error: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const batches = await response.json() as Array<{
    results?: Array<{ metrics?: { costMicros?: string }; customer?: { currencyCode?: string } }>;
  }>;
  let micros = 0;
  let currency: string | null = null;
  for (const batch of batches) {
    for (const result of batch.results ?? []) {
      micros += Number(result.metrics?.costMicros ?? 0);
      currency ??= result.customer?.currencyCode ?? null;
    }
  }
  const resolved = currency && /^[A-Z]{3}$/.test(currency) ? currency : configCurrency(config);
  return { amountMinor: microsToMinorUnits(micros, resolved), currency: resolved };
}

async function fetchXCost(config: AdPlatformConfig, day: string): Promise<FetchedCost> {
  const currency = configCurrency(config);
  const accountId = String(config.account_id);
  const url = `https://ads-api.x.com/12/stats/accounts/${encodeURIComponent(accountId)}`
    + `?entity=ACCOUNT&entity_ids=${encodeURIComponent(accountId)}`
    + `&metric_groups=BILLING&granularity=DAY&placement=ALL_ON_TWITTER`
    + `&start_time=${encodeURIComponent(`${day}T00:00:00+09:00`)}`
    + `&end_time=${encodeURIComponent(`${day}T23:59:59+09:00`)}`;
  const authorization = await buildXOAuth1Header('GET', url, {
    consumerKey: String(config.api_key),
    consumerSecret: String(config.api_secret),
    token: typeof config.x_oauth_token === 'string' ? config.x_oauth_token : undefined,
    tokenSecret: typeof config.x_oauth_token_secret === 'string' ? config.x_oauth_token_secret : undefined,
  });
  const response = await fetch(url, { headers: { Authorization: authorization } });
  if (!response.ok) {
    throw new Error(`X Ads API error: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json() as {
    data?: Array<{ id_data?: Array<{ metrics?: { billed_charge_local_micro?: number[] } }> }>;
  };
  const micros = Number(payload.data?.[0]?.id_data?.[0]?.metrics?.billed_charge_local_micro?.[0] ?? 0);
  if (!Number.isFinite(micros)) throw new Error('X Ads API の応答に費用がありません');
  return { amountMinor: microsToMinorUnits(micros, currency), currency };
}

async function fetchTikTokCost(config: AdPlatformConfig, day: string): Promise<FetchedCost> {
  const currency = configCurrency(config);
  const params = new URLSearchParams({
    advertiser_id: String(config.advertiser_id),
    report_type: 'BASIC',
    data_level: 'AUCTION_ADVERTISER',
    dimensions: JSON.stringify(['advertiser_id']),
    metrics: JSON.stringify(['spend']),
    start_date: day,
    end_date: day,
    page_size: '10',
  });
  const url = `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params}`;
  const response = await fetch(url, {
    headers: { 'Access-Token': String(config.access_token) },
  });
  if (!response.ok) {
    throw new Error(`TikTok API error: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  const payload = await response.json() as {
    code?: number;
    message?: string;
    data?: { list?: Array<{ metrics?: { spend?: string } }> };
  };
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(`TikTok API error: ${payload.message ?? `code=${payload.code}`}`);
  }
  const spend = Number(payload.data?.list?.[0]?.metrics?.spend ?? 0);
  if (!Number.isFinite(spend)) throw new Error('TikTok API の応答に費用がありません');
  return { amountMinor: toMinorUnits(spend, currency), currency };
}

const FETCHERS: Record<string, (config: AdPlatformConfig, day: string) => Promise<FetchedCost>> = {
  meta: fetchMetaCost,
  x: fetchXCost,
  google: fetchGoogleCost,
  tiktok: fetchTikTokCost,
};

function platformLabel(platform: AdPlatform): string {
  return platform.display_name?.trim() || platform.name;
}

/** 1媒体の1日分を取り込む。成否を実行台帳に残し、結果を返す。 */
export async function importAdCostForPlatform(
  db: D1Database,
  platform: AdPlatform,
  opts: { day: string; credentialKey?: string; force?: boolean },
): Promise<{ status: 'success' | 'failed' | 'skipped'; error?: string }> {
  if (!opts.force && await hasSuccessfulAdCostImport(db, platform.id, opts.day)) {
    return { status: 'skipped' };
  }
  try {
    const config = await resolveAdPlatformConfig(platform, opts.credentialKey);
    if (!config) throw new Error('連携設定を読み込めません');
    const missing = missingConfigKey(platform, config);
    if (missing) throw new Error(`連携設定に ${missing} がありません`);
    const fetcher = FETCHERS[platform.name];
    if (!fetcher) throw new Error(`費用取込に対応していない媒体です: ${platform.name}`);

    const cost = await fetcher(config, opts.day);
    const entryRouteId = typeof config.entry_route_id === 'string' && config.entry_route_id
      ? config.entry_route_id
      : null;
    await upsertAdCostEntry(db, {
      lineAccountId: platform.line_account_id ?? '',
      adPlatformId: platform.id,
      entryRouteId,
      sourceLabel: platformLabel(platform),
      day: opts.day,
      amountMinor: cost.amountMinor,
      currency: cost.currency,
      source: 'import',
    });
    await recordAdCostImportRun(db, {
      adPlatformId: platform.id,
      day: opts.day,
      status: 'success',
    });
    return { status: 'success' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAdCostImportRun(db, {
      adPlatformId: platform.id,
      day: opts.day,
      status: 'failed',
      errorMessage: message.slice(0, 500),
    });
    return { status: 'failed', error: message };
  }
}

/**
 * 動いている外部連携すべてについて前日分(JST)を取り込む。
 * 6時間レーンのcronから呼ぶ。1媒体の失敗が他を止めない。
 */
export async function importAdCosts(
  db: D1Database,
  opts: { day: string; credentialKey?: string },
): Promise<{ processed: number; imported: number; failed: number; skipped: number }> {
  const platforms = (await getAdPlatforms(db)).filter(
    (platform) => platform.is_active === 1 && platform.line_account_id,
  );
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  for (const platform of platforms) {
    const result = await importAdCostForPlatform(db, platform, opts);
    if (result.status === 'success') imported++;
    else if (result.status === 'failed') failed++;
    else skipped++;
  }
  return { processed: platforms.length, imported, failed, skipped };
}

/** 管理画面の「今すぐ取り込む」ボタンから呼ぶ単発版。 */
export async function importAdCostNow(
  db: D1Database,
  adPlatformId: string,
  opts: { day: string; credentialKey?: string },
): Promise<{ status: 'success' | 'failed' | 'skipped'; error?: string }> {
  const platform = await getAdPlatformById(db, adPlatformId);
  if (!platform) return { status: 'failed', error: '連携が見つかりません' };
  // 媒体側の数値は確定まで変わることがあるので、手動では同じ日を取り直せる。
  return importAdCostForPlatform(db, platform, { ...opts, force: true });
}
