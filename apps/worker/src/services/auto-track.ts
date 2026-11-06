import { issueTrackedLinkIdentity } from './tracked-link-identity.js';
import { convertBroadcastAsset, isBroadcastAssetKind } from '@line-crm/shared';
import { decorateTapExtras } from './tap-extra-links.js';
import { getOrCreateAutoTrackedLink, getTrackedLinkByIdOrShortCode } from '@line-crm/db';
import { resolveTrackedLinkBaseUrl } from '../lib/link-base-url.js';

// Universal Link / App Link で開くドメイン。
const APP_LINK_DOMAINS = new Set([
  'x.com',
  'twitter.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'facebook.com',
  'github.com',
]);

function isAppLinkDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (APP_LINK_DOMAINS.has(hostname)) return true;
    // モバイルや地域別のサブドメインも、.ルートドメインの末尾一致で扱う。
    for (const root of APP_LINK_DOMAINS) {
      if (hostname.endsWith(`.${root}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * URL に `openExternalBrowser=1` を追加する。`#fragment` がある場合は fragment の前に
 * 入れる必要がある (`...?param=1#anchor` の順序を保たないと LINE がフラグを認識しない、
 * かつ fragment 自体が変わって anchored リンク先 (GitHub コメント等) が壊れる)。
 */
function appendOpenExternalBrowser(url: string): string {
  if (url.includes('openExternalBrowser=')) return url;
  const hashIdx = url.indexOf('#');
  const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}openExternalBrowser=1${fragment}`;
}

const URL_REGEX = /https?:\/\/[^\s"'<>\])}]+/g;

// 内部・システムの URL は計測リンクで包まない。
const SKIP_PATTERNS = [
  /\/t\/[0-9a-f-]{36}/,       // already a tracking link (legacy UUID form)
  /liff\.line\.me/,            // LIFF URLs
  /line\.me\/R\//,             // LINE deep links
  /your-worker-name/,           // our own worker
];

function shouldSkip(url: string, skipPrefixes: string[]): boolean {
  if (SKIP_PATTERNS.some((p) => p.test(url))) return true;
  // 短縮コードは UUID の式に当たらないため、自分の Worker と独自短縮ドメインも除外し、再短縮を防ぐ。
  return skipPrefixes.some((prefix) => prefix && url.startsWith(`${prefix}/t/`));
}


function extractUrls(content: string, skipPrefixes: string[]): Set<string> {
  const urls = new Set<string>();
  for (const match of content.matchAll(URL_REGEX)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    if (!shouldSkip(url, skipPrefixes)) urls.add(url);
  }
  return urls;
}


async function createTrackingMap(
  db: D1Database,
  urls: Set<string>,
  linkBase: string,
  lineAccountId?: string | null,
  templateId?: string | null,
  broadcastId?: string | null,
): Promise<Map<string, { trackingUrl: string; originalUrl: string; label: string }>> {
  // カルーセルの多数 URL で D1 往復が積み重ならないよう、独立した解決を並列に行う。
  const entries = await Promise.all(
    [...urls].map(async (url) => {
      // 宛先ごとの配信でリンク行が増殖しないよう、同じ URL・アカウントの自動リンクを再利用する。
      const link = await getOrCreateAutoTrackedLink(db, {
        originalUrl: url,
        lineAccountId: lineAccountId ?? null,
        templateId: templateId ?? null,
        dedupScope: broadcastId ? `broadcast:${broadcastId}` : null,
      });
      // Worker が LINE 判別と LIFF 移動を行う /t/ を使い、独自ドメインでも短縮コードを優先する。
      const trackingUrl = `${linkBase}/t/${link.short_code ?? link.id}`;
      const hostname = new URL(url).hostname.replace('www.', '');
      const label = hostname.length > 20 ? hostname.slice(0, 20) + '…' : hostname;
      if (broadcastId) {
        await db.prepare(
          `INSERT INTO broadcast_tracked_links (broadcast_id, tracked_link_id, label, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(broadcast_id, tracked_link_id) DO UPDATE SET label = excluded.label`,
        ).bind(broadcastId, link.id, label, new Date().toISOString()).run();
      }
      return [url, { trackingUrl, originalUrl: url, label }] as const;
    }),
  );
  return new Map(entries);
}


function textToFlex(
  text: string,
  links: { trackingUrl: string; originalUrl: string; label: string }[],
): string {

  let cleanText = text;
  for (const link of links) {
    cleanText = cleanText.split(link.originalUrl).join('').trim();
  }

  cleanText = cleanText.replace(/\s{2,}/g, ' ').replace(/[👉🔗➡️]\s*$/g, '').trim();

  const bodyContents: unknown[] = [];
  if (cleanText) {
    bodyContents.push({
      type: 'text',
      text: cleanText,
      size: 'md',
      color: '#333333',
      wrap: true,
    });
  }

  const buttons = links.map((link) => {
    // LINE 内でなく Safari/Chrome へ渡すため、アプリリンクに openExternalBrowser=1 を付ける。
    const uri = isAppLinkDomain(link.originalUrl)
      ? `${link.trackingUrl}${link.trackingUrl.includes('?') ? '&' : '?'}openExternalBrowser=1`
      : link.trackingUrl;
    return {
      type: 'button',
      action: {
        type: 'uri',
        label: `${link.label} を開く`,
        uri,
      },
      style: 'primary',
      color: '#1a1a2e',
      margin: 'sm',
    };
  });

  const bubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: bodyContents,
      paddingAll: '16px',
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: buttons,
      paddingAll: '12px',
    },
  };

  return JSON.stringify(bubble);
}

export interface AutoTrackResult {
  messageType: string;
  content: string;
}

export interface AutoTrackOptions {
  /** 別アカウントの同意画面を出さないよう、作成した計測リンクの所属を使い、クリックはそのアカウントの LIFF へ戻す。 */
  lineAccountId?: string | null;
  /** この本文が属するテンプレート（110）。クリックをテンプレート単位で数えるため。 */
  templateId?: string | null;
  /** 配信別に短縮URLとクリック数を分ける。 */
  broadcastId?: string | null;
  sourceContent?: string;
}

/** 個別送信のリンクへ期限付きの本人資格を付ける。複数人へ同じ本文を送る配信では使わない。 */
export async function appendFriendToTrackedLinks(
  db: D1Database,
  content: string,
  workerUrl: string,
  friendId: string | null | undefined,
): Promise<string> {
  if (!friendId) return content;
  // 計測リンクは必ず /t/ を含むため、ない本文は設定読取を省く。短時間で送る replyToken の前処理を軽くする。
  if (!content.includes('/t/')) return content;
  const workerBase = workerUrl.replace(/\/$/, '');
  const linkBase = await resolveTrackedLinkBaseUrl(db, workerUrl);
  const bases = [...new Set([workerBase, linkBase])];
  const replacements = await Promise.all([...content.matchAll(URL_REGEX)].map(async ([match]) => {
    const ascii = match.match(/^[\x21-\x7E]+/)?.[0] ?? '';
    const punct = ascii.match(/[.,;:!?)]+$/)?.[0] ?? '';
    const url = punct ? ascii.slice(0, -punct.length) : ascii;
    const trailing = match.slice(url.length);
    if (!bases.some((base) => url.startsWith(`${base}/t/`))) return [match, match] as const;
    let parsed: URL;
    let identifier: string;
    try {
      parsed = new URL(url);
      identifier = decodeURIComponent(parsed.pathname.slice(3));
    } catch { return [match, match] as const; }
    const link = await getTrackedLinkByIdOrShortCode(db, identifier);
    const token = link ? await issueTrackedLinkIdentity(db, link, friendId) : null;
    parsed.searchParams.delete('f');
    parsed.searchParams.delete('lu');
    parsed.searchParams.delete('identity');
    if (token) parsed.searchParams.set('identity', token);
    return [match, `${parsed.toString()}${trailing}`] as const;
  }));
  const byMatch = new Map(replacements);
  return content.replace(URL_REGEX, (match) => byMatch.get(match) ?? match);
}

/** メッセージ種別を変えず、text と Flex の URL だけを計測リンクへ置き換える。 */
export async function autoTrackContent(
  db: D1Database,
  messageType: string,
  content: string,
  workerUrl: string,
  options?: AutoTrackOptions,
): Promise<AutoTrackResult> {
  if (messageType === 'image') return { messageType, content };
  const workerBase = workerUrl.replace(/\/$/, '');
  const authored = options?.sourceContent === undefined ? null : extractUrls(options.sourceContent, [workerBase]);
  const isAuthored = (url: string) => !authored || authored.has(url) && !/[{}]/.test(url);
  if (messageType !== 'text' && content.includes('\"tapExtras\"')) {
    let tree = JSON.parse(content);
    if (isBroadcastAssetKind(messageType)) {
      const converted = convertBroadcastAsset(messageType, tree.assetName ?? '', tree);
      if (!converted.ok) throw new Error(converted.error);
      messageType = converted.message.messageType;
      tree = JSON.parse(converted.message.messageContent);
    }
    content = JSON.stringify(await decorateTapExtras(db, tree, workerUrl, options?.lineAccountId ?? null, options?.templateId, options?.broadcastId, isAuthored));
  }

  // 宛先ごとのループで不要な設定読取を増やさないよう、先に URL を抽出し、ない本文は省く。

  let urls = new Set([...extractUrls(content, [workerBase])].filter(isAuthored));
  if (urls.size === 0) return { messageType, content };

  // 独自短縮ドメインを優先し、既に計測済みの /t/ は再び包まない。
  const linkBase = await resolveTrackedLinkBaseUrl(db, workerUrl);
  if (linkBase !== workerBase) {
    urls = new Set([...urls].filter((u) => !u.startsWith(`${linkBase}/t/`)));
    if (urls.size === 0) return { messageType, content };
  }

  // Text messages: app-link domain (YouTube / X / TikTok 等) は raw URL を残して
  //   `?openExternalBrowser=1` だけ付ける。LINE 上で rich preview (YT サムネ等) が
  //   描画されるので「短い URL + プレビュー」というユーザー体験になる。クリックは
  //   ファーストパーティ計測できないが、それらのプラットフォームが自社で計測する。
  // Flex messages: trackingUrl + openExternalBrowser=1 (button 化されてプレビュー
  //   は不要なため、tracking 優先する従来通り)。
  if (messageType === 'text') {
    // app-link domain は tracking 不要なので createTrackedLink 自体スキップする
    // (無駄な link_clicks レコード防止)。
    const trackable = new Set([...urls].filter((u) => !isAppLinkDomain(u)));
    const urlMap = trackable.size > 0
      ? await createTrackingMap(db, trackable, linkBase, options?.lineAccountId, options?.templateId, options?.broadcastId)
      : new Map<string, { trackingUrl: string; originalUrl: string; label: string }>();

    let result = content;
    for (const url of urls) {
      let replacement: string;
      if (isAppLinkDomain(url)) {
        replacement = appendOpenExternalBrowser(url);
      } else {
        const tracked = urlMap.get(url);
        replacement = tracked ? tracked.trackingUrl : url;
      }
      result = result.split(url).join(replacement);
    }
    return { messageType: 'text', content: result };
  }

  // Flex は uri アクションだけを変換する。画像・動画・アイコンの url は LINE が直接読むため、HTML を返す /t/ へ置換して表示を壊さない。
  let tree: unknown;
  try {
    tree = JSON.parse(content);
  } catch {
    // JSON が不正なら、変換でさらに壊さないよう元のまま返す。
    return { messageType, content };
  }
  const skipPrefixes = linkBase !== workerBase ? [workerBase, linkBase] : [workerBase];
  const actionUris = new Set<string>();
  collectActionUris(tree, actionUris);
  // tel:/line: や壊れた URL で配信全体が失敗しないよう、有効な HTTP(S) の URI だけを計測対象にする。
  const trackableUris = new Set(
    [...actionUris].filter((u) => isTrackableHttpUrl(u) && !shouldSkip(u, skipPrefixes) && isAuthored(u)),
  );
  if (trackableUris.size === 0) return { messageType, content };
  const uriMap = await createTrackingMap(db, trackableUris, linkBase, options?.lineAccountId, options?.templateId, options?.broadcastId);
  rewriteActionUris(tree, (u) => {
    const tracked = uriMap.get(u);
    if (!tracked) return u;
    return isAppLinkDomain(u)
      ? appendOpenExternalBrowser(tracked.trackingUrl)
      : tracked.trackingUrl;
  });
  return { messageType, content: JSON.stringify(tree) };
}

/** 後続の new URL へ安全に渡せる、解析済みの HTTP(S) だけを許す。 */
function isTrackableHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}


function visitActionUris(node: unknown, visit: (holder: Record<string, unknown>, key: string) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visitActionUris(child, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of ['action', 'defaultAction']) {
    const a = obj[key] as Record<string, unknown> | undefined;
    if (a && a.type === 'uri') {
      if (typeof a.uri === 'string') visit(a, 'uri');
      // PC の LINE は altUri.desktop を使うため、通常の uri と同じく計測する。
      const alt = a.altUri as Record<string, unknown> | undefined;
      if (alt && typeof alt.desktop === 'string') visit(alt, 'desktop');
    }
  }
  for (const value of Object.values(obj)) visitActionUris(value, visit);
}

function collectActionUris(node: unknown, out: Set<string>): void {
  visitActionUris(node, (holder, key) => out.add(holder[key] as string));
}

function rewriteActionUris(node: unknown, fn: (u: string) => string): void {
  visitActionUris(node, (holder, key) => {
    holder[key] = fn(holder[key] as string);
  });
}

/** 宛先別の通常配信と即時初回文で差が出ないよう、URL の計測化と署名付き本人情報の追加を共通化する。本人情報付きなので multicast/broadcast には使わず、Worker URL がなければ入力を保つ。 */
export async function decorateForFriendPush(
  db: D1Database,
  messageType: string,
  content: string,
  workerUrl: string | undefined,
  opts: { lineAccountId: string | null; friendId: string; sourceContent?: string },
): Promise<AutoTrackResult> {
  if (!workerUrl) return { messageType, content };
  const tracked = await autoTrackContent(db, messageType, content, workerUrl, {
    lineAccountId: opts.lineAccountId,
    sourceContent: opts.sourceContent ?? '',
  });
  const decorated = await appendFriendToTrackedLinks(db, tracked.content, workerUrl, opts.friendId);
  return { messageType: tracked.messageType, content: decorated };
}
