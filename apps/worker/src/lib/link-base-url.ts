import { getLinkBaseUrl, getTrackedLinkBaseUrl } from '@line-crm/db';

/**
 * アフィリエイトリンクの基底 URL は、全体設定 link_base_url、未設定なら <WORKER_URL>/r の順で解決する。
 * 呼び出し元は /<slug> だけを足す。独自ドメインでは設定がパスの正本なので、/r を重ねない。
 * 設定も WORKER_URL もないと壊れたリンクを返すため、localhost などで補わず失敗させる。
 */
export async function resolveLinkBaseUrl(
  db: D1Database,
  env: { WORKER_URL?: string },
): Promise<string> {
  const stored = await getLinkBaseUrl(db, '__global__');
  if (stored) {
    // setLinkBaseUrl が末尾のスラッシュを除いて正規化済み。
    return stored;
  }

  const workerUrl = env.WORKER_URL?.trim();
  if (!workerUrl) {
    throw new Error(
      'WORKER_URL is not configured; cannot resolve affiliate link base URL',
    );
  }
  return workerUrl.replace(/\/$/, '') + '/r';
}

/**
 * メッセージ計測リンクは全体設定 tracked_link_base_url を優先し、なければ Worker URL または要求元を使う。
 * どちらも基底だけを返し、呼び出し元が /t/<code> を付けることで同じ URL 形式を保つ。
 */
export async function resolveTrackedLinkBaseUrl(
  db: D1Database,
  fallback: string,
): Promise<string> {
  const stored = await getTrackedLinkBaseUrl(db, '__global__');
  if (stored) return stored;
  return fallback.replace(/\/$/, '');
}
