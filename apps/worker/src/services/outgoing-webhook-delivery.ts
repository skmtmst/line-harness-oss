/**
 * 送信Webhookの配送。
 *
 * これまで fetch を投げっぱなしにしていて、次の2つが起きていた:
 *   - 相手が 500 を返しても成功として扱っていた（例外にならないため）
 *   - 一度失敗したら終わりで、送り直す手立てが無かった
 *
 * 093 で足した列を使って、送り直しと失敗の記録を入れる。
 */

/** 送り直しまでの待ち時間（ミリ秒）。 */
export function retryDelayMs(attempt: number): number {
  // 1回目 0.5秒、2回目 1秒、3回目 2秒…と倍にして、8秒で頭打ちにする。
  // Worker の実行時間には限りがあるので、分単位では待たない。
  // 相手が長時間落ちている場合まで面倒を見るなら、キューに積む別の設計が要る。
  return Math.min(8000, 500 * 2 ** attempt);
}

/**
 * 送り直す価値のある応答か。
 *
 * 4xx は相手が「この内容は受け取れない」と言っているので、同じものを
 * 送り直しても結果は変わらない。429（多すぎる）だけは時間を置けば通るので送り直す。
 */
export function shouldRetryStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500;
}

export interface WebhookRow {
  id: string;
  url: string;
  secret: string | null;
  max_retries: number | null;
}

async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 送信直前の SSRF 再検査 (N-366)。
 *
 * 登録時の検査だけでは、古い設定のまま DNS が差し替わったり、
 * 転送先が内部を向いたりしたときに内部・private 宛てへ送ってしまう。
 * そのため送るたびに「HTTPSか・host/IPは公開側か・転送先の各段は安全か」
 * を確かめてから送る。DNS は送るたびに引き直し、結果は使い回さない。
 *
 * 配送の境界は2層である。アプリ層(このファイル)は fail-closed の検査で
 * 非公開宛てを送る前に止め、秘密値なしで台帳へ残す。同一 hop 内では
 * 接続直前にもう一度引いて検査時との一致を確かめ、違えば送らない。
 * 基盤層(Cloudflare)側は次の公式仕様が非公開宛てへの到達そのものを断つ。
 * staging/prod 両方の wrangler には global_fetch_strictly_public を適用し、
 * subrequest を公開インターネット経路に限定している。
 * - 自分以外のゾーンへ cf.resolveOverride は効かない(接続の固定化は不可)。
 *   https://developers.cloudflare.com/workers/runtime-apis/request/
 * - Cloudflare 所有IPへの subrequest は 1024 で拒否される。
 *   https://developers.cloudflare.com/workers/observability/errors/
 * - Workers が private origin へ届くのは VPC 等の binding 経由だけ。
 *   この Worker に private 用 binding は無い(apps/worker/wrangler.toml)。
 *   https://blog.cloudflare.com/private-origins-dns-routing/
 * 残るのは公開→公開の差し替え(誤配送のみ。秘密値は送らない)である。
 */

export type WebhookDnsLookup = (host: string) => Promise<string[]>;

export type WebhookBlockReason =
  | 'invalid_url'
  | 'non_https'
  | 'credentials_in_url'
  | 'blocked_host'
  | 'blocked_ip'
  | 'dns_unresolved'
  | 'dns_changed'
  | 'unsafe_redirect';

function parseIpv4Parts(host: string): number[] | null {
  // 10進のほか、0始まりの8進・0x始まりの16進の書き方もIPとして読む。
  // そうしないと 0x7f.0.0.1 のような書き方で抜け道になる。
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (part.length === 0) return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(part)) n = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
    else if (/^\d+$/.test(part)) n = parseInt(part, 10);
    else return null;
    if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
    nums.push(n);
  }
  return nums;
}

function ipv4ToBytes(nums: number[]): number[] | null {
  if (nums.length === 0) return null;
  if (nums.length === 4) {
    return nums.every((n) => n <= 255) ? [...nums] : null;
  }
  if (nums.length === 3) {
    if (nums[0] > 255 || nums[1] > 255 || nums[2] > 65535) return null;
    return [nums[0], nums[1], (nums[2] >> 8) & 255, nums[2] & 255];
  }
  if (nums.length === 2) {
    if (nums[0] > 255 || nums[1] > 16777215) return null;
    return [nums[0], (nums[1] >> 16) & 255, (nums[1] >> 8) & 255, nums[1] & 255];
  }
  const n = nums[0];
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function isBlockedIpv4Bytes(b: number[]): boolean {
  const [a, c, d] = b;
  if (a === 10) return true;
  if (a === 172 && c >= 16 && c <= 31) return true;
  if (a === 192 && c === 168) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  // link-local。クラウドの metadata (169.254.169.254) もここで止まる。
  if (a === 169 && c === 254) return true;
  if (a === 100 && c >= 64 && c <= 127) return true;
  if (a === 192 && c === 0 && d === 0) return true;
  if (a === 192 && c === 0 && d === 2) return true;
  if (a === 198 && (c === 18 || c === 19)) return true;
  if (a === 198 && c === 51 && d === 100) return true;
  if (a === 203 && c === 0 && d === 113) return true;
  if (a >= 224 && a <= 239) return true;
  if (a >= 240) return true;
  return false;
}

function expandIpv6(host: string): number[] | null {
  // 8群の数値列へ展開する。書式が崩れていたら null(送らない側に倒す)。
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const parts = [...head, ...tail];
  if (parts.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const nums = parts.map((g) => parseInt(g, 16));
  if (halves.length === 1) return nums.length === 8 ? nums : null;
  if (nums.length > 7) return null;
  return [...nums.slice(0, head.length), ...new Array(8 - nums.length).fill(0), ...nums.slice(head.length)];
}

function isBlockedIpv6Groups(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g.every((n) => n === 0)) return true;
  if (g.slice(0, 7).every((n) => n === 0) && g7 === 1) return true;
  // link-local fe80::/10。fe80〜febf の全範囲を止める。
  if ((g0 & 0xffc0) === 0xfe80) return true;
  if ((g0 & 0xffc0) === 0xfec0) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;
  const v4bytes = (hi: number, lo: number) => [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
  // ::ffff:0:0/96 の IPv4 射影は中の IPv4 で判断する。
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedIpv4Bytes(v4bytes(g6, g7));
  }
  // 6to4 (2002::/16) は中に IPv4 を埋め込むので同じく判断する。
  if (g0 === 0x2002) return isBlockedIpv4Bytes(v4bytes(g1, g2));
  // Teredo (2001::/32) は判別が複雑なため送らない。ISATAP は中の IPv4 で判断する。
  if (g0 === 0x2001 && g1 === 0x0000) return true;
  if (g4 === 0 && g5 === 0x5efe) return isBlockedIpv4Bytes(v4bytes(g6, g7));
  return false;
}

function isBlockedIpv6Literal(host: string): boolean {
  const h = host.toLowerCase();
  if (h.includes('.')) {
    // ::ffff:127.0.0.1 形式だけ受け付け、中のIPv4で判断する。
    if (!h.startsWith('::ffff:')) return true;
    const bytes = ipv4ToBytes(parseIpv4Parts(h.slice('::ffff:'.length)) ?? []);
    if (!bytes) return true;
    return isBlockedIpv4Bytes(bytes);
  }
  const groups = expandIpv6(h);
  if (!groups) return true;
  return isBlockedIpv6Groups(groups);
}

function normalizeHostname(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
}

/** 文字面だけの検査。DNS は引かない。 */
export function webhookUrlBlockReason(value: string): WebhookBlockReason | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'https:') return 'non_https';
  if (url.username || url.password) return 'credentials_in_url';
  const raw = url.hostname.toLowerCase();
  if (raw.includes('%')) return 'blocked_host';
  const host = raw.replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === 'metadata.google.internal'
    || host.endsWith('.metadata.google.internal')
    || host === 'metadata.google.com'
  ) return 'blocked_host';
  if (host.includes(':')) {
    return isBlockedIpv6Literal(host) ? 'blocked_ip' : null;
  }
  const nums = parseIpv4Parts(host);
  if (nums) {
    const bytes = ipv4ToBytes(nums);
    if (!bytes) return 'blocked_ip';
    return isBlockedIpv4Bytes(bytes) ? 'blocked_ip' : null;
  }
  // 数字・点・16進の文字だけでIPに見える書き方は、上の桁検査を
  // 通らなければ送らない(末尾が数字TLDの名前は実在しないため)。
  if (/^[0-9a-fx.]+$/i.test(host) && /\d/.test(host)) {
    return 'blocked_ip';
  }
  return null;
}

export function isSafeWebhookUrl(value: string): boolean {
  return webhookUrlBlockReason(value) === null;
}

function ipAddressBlockReason(address: string): WebhookBlockReason | null {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (host.includes(':')) {
    return isBlockedIpv6Literal(host) ? 'blocked_ip' : null;
  }
  const bytes = ipv4ToBytes(parseIpv4Parts(host) ?? []);
  if (!bytes) return 'blocked_ip';
  return isBlockedIpv4Bytes(bytes) ? 'blocked_ip' : null;
}

async function dohQuery(host: string, type: 'A' | 'AAAA', fetchImpl: typeof fetch): Promise<string[]> {
  const res = await fetchImpl(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
    { headers: { accept: 'application/dns-json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) },
  );
  // 片系だけ失敗して他方が公開でも通さない。接続時は両系とも引けるため、
  // 見えていない系が非公開かもしれない状態で送らない(fail-closed)。
  if (!res.ok) throw new Error(`dns query failed: ${type} ${res.status}`);
  const data = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
  const want = type === 'A' ? 1 : 28;
  const out: string[] = [];
  for (const answer of data.Answer ?? []) {
    if (answer.type !== want || typeof answer.data !== 'string') continue;
    out.push(answer.data.replace(/\.$/, ''));
  }
  return out;
}

async function defaultLookupHost(host: string, fetchImpl: typeof fetch): Promise<string[]> {
  // 例外時は空を返し、呼び出し側で fail-closed(送らない) にする。
  try {
    const [a, aaaa] = await Promise.all([
      dohQuery(host, 'A', fetchImpl),
      dohQuery(host, 'AAAA', fetchImpl),
    ]);
    return [...a, ...aaaa];
  } catch {
    return [];
  }
}

export interface WebhookSafetyOptions {
  lookupHost?: WebhookDnsLookup;
  fetchImpl?: typeof fetch;
}

export type WebhookSafetyVerdict = { ok: true; addresses: string[] } | { ok: false; reason: WebhookBlockReason };

async function resolveHostAddresses(
  host: string,
  opts: WebhookSafetyOptions,
): Promise<{ ok: true; addresses: string[] } | { ok: false; reason: 'dns_unresolved' }> {
  const lookup = opts.lookupHost ?? ((h) => defaultLookupHost(h, opts.fetchImpl ?? fetch));
  try {
    const addresses = await lookup(host);
    if (addresses.length === 0) return { ok: false, reason: 'dns_unresolved' };
    return { ok: true, addresses };
  } catch {
    return { ok: false, reason: 'dns_unresolved' };
  }
}

function checkResolvedAddresses(addresses: string[]): WebhookBlockReason | null {
  for (const address of addresses) {
    const reason = ipAddressBlockReason(address);
    if (reason) return reason;
  }
  return null;
}

/**
 * 送信直前の再検査。文字面の検査に加え、名前はその場で引き直して
 * 1件でも内部・private 側のIPが混ざっていたら止める。
 *
 * 名前が引けない・空のときは送らない(fail-closed)。
 * 検査したIPへ接続を固定する手段が実行環境にないため、引き直しは
 * 送る直前・送り直し・転送の各段で毎回行い、結果を使い回さない。
 * 同一 hop 内では接続直前にもう一度引いて一致を確かめる(後述)。
 */
export async function checkWebhookUrlSafety(
  value: string,
  opts: WebhookSafetyOptions = {},
): Promise<WebhookSafetyVerdict> {
  const literal = webhookUrlBlockReason(value);
  if (literal) return { ok: false, reason: literal };
  const host = normalizeHostname(value);
  if (!host) return { ok: false, reason: 'invalid_url' };
  if (host.includes(':') || ipv4ToBytes(parseIpv4Parts(host) ?? [])) return { ok: true, addresses: [] };
  const resolved = await resolveHostAddresses(host, opts);
  if (!resolved.ok) return resolved;
  const reason = checkResolvedAddresses(resolved.addresses);
  if (reason) return { ok: false, reason };
  return { ok: true, addresses: resolved.addresses };
}

export interface SafePostOptions {
  fetchImpl?: typeof fetch;
  lookupHost?: WebhookDnsLookup;
  maxRedirects?: number;
}

export type SafePostOutcome = { response: Response } | { blocked: WebhookBlockReason };

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function sameWebhookOrigin(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const port = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '');
    return (
      x.protocol === y.protocol
      && x.hostname.toLowerCase() === y.hostname.toLowerCase()
      && port(x) === port(y)
    );
  } catch {
    return false;
  }
}

// 別の送り先へ持ち越さない頭。署名・冪等・本文に関するものだけ落とす。
const CROSS_ORIGIN_DROPPED_HEADERS = new Set([
  'content-type',
  'content-length',
  'x-webhook-signature',
  'x-webhook-delivery-id',
  'idempotency-key',
  'authorization',
  'cookie',
]);

function stripCrossOriginHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!CROSS_ORIGIN_DROPPED_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  return out;
}

/**
 * 転送を1段ずつ手で辿りながら送る。転送先も送る前に再検査する。
 * 転送の段数が上限を超えたら最後の応答をそのまま返す(3xxは失敗扱い)。
 * 別の origin への転送では署名・冪等・本文の頭を持ち越さない。
 * 本文を保ったまま別 origin へ転送する応答(307/308)は送らずに止める。
 */
export async function postWebhookSafely(
  url: string,
  init: { headers: Record<string, string>; body?: string; signal?: AbortSignal },
  opts: SafePostOptions = {},
): Promise<SafePostOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = url;
  let method = 'POST';
  let headers = { ...init.headers };
  let body: string | undefined = init.body;
  let hop = 0;
  for (;;) {
    const safety = await checkWebhookUrlSafety(current, {
      lookupHost: opts.lookupHost,
      fetchImpl,
    });
    if (!safety.ok) return { blocked: safety.reason };
    // 同一 hop の分岐対策: 接続の直前にもう一度引き、検査時と1件でも
    // 違えば送らない。差し替えはこの2回の引きの間に収まらないと通らない。
    if (safety.addresses.length > 0) {
      const host = normalizeHostname(current);
      const again = host
        ? await resolveHostAddresses(host, { lookupHost: opts.lookupHost, fetchImpl })
        : null;
      if (!again || !again.ok) return { blocked: 'dns_unresolved' };
      const before = [...safety.addresses].sort().join(',');
      const now = [...again.addresses].sort().join(',');
      if (before !== now) return { blocked: 'dns_changed' };
    }
    const response = await fetchImpl(current, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: init.signal,
    });
    if (!REDIRECT_STATUS.has(response.status) || hop >= maxRedirects) return { response };
    const location = response.headers?.get?.('location');
    if (!location) return { response };
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      return { response };
    }
    if (!sameWebhookOrigin(current, next)) {
      // 本文付きのまま別 origin へは送らない(再署名の材料がここに無いため)。
      if (response.status === 307 || response.status === 308) return { blocked: 'unsafe_redirect' };
      headers = stripCrossOriginHeaders(headers);
    }
    current = next;
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
    hop++;
  }
}

export interface DeliveryResult {
  ok: boolean;
  attempts: number;
  lastStatus: number | null;
  blocked?: boolean;
  blockReason?: WebhookBlockReason | null;
}

/**
 * 1件のWebhookへ送る。失敗したら max_retries の回数だけ送り直す。
 *
 * 例外を投げない。呼び出し側は「送れたかどうか」を戻り値で受け取る。
 * 送信の失敗でイベント処理そのものを止めたくないため。
 */
export async function deliverWebhook(
  webhook: WebhookRow,
  body: string,
  opts: {
    sleep?: (ms: number) => Promise<void>;
    idempotencyKey?: string;
    fetchImpl?: typeof fetch;
    lookupHost?: WebhookDnsLookup;
  } = {},
): Promise<DeliveryResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = Math.max(0, Math.min(5, webhook.max_retries ?? 0));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.idempotencyKey) headers['X-Webhook-Delivery-Id'] = opts.idempotencyKey;
  if (webhook.secret) {
    headers['X-Webhook-Signature'] = await sign(webhook.secret, body);
  }

  let lastStatus: number | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs(attempt - 1));
    // 送り直しのたびに検査し直す。古い検査結果は使い回さない。
    let outcome: SafePostOutcome;
    try {
      outcome = await postWebhookSafely(webhook.url, { headers, body }, {
        fetchImpl: opts.fetchImpl,
        lookupHost: opts.lookupHost,
      });
    } catch (err) {
      // 接続そのものが失敗した場合。相手が落ちている可能性が高いので送り直す。
      console.error(`送信Webhook ${webhook.id} への接続失敗:`, err);
      lastStatus = null;
      continue;
    }
    if ('blocked' in outcome) {
      // 安全でない送り先。送り直しても変わらないのでその場で止める。
      // 呼び出し側が result.ok を見て失敗台帳へ残す(秘密値は渡さない)。
      return { ok: false, attempts: attempt + 1, lastStatus, blocked: true, blockReason: outcome.blocked };
    }
    const res = outcome.response;
    lastStatus = res.status;
    if (res.ok) return { ok: true, attempts: attempt + 1, lastStatus };
    if (!shouldRetryStatus(res.status)) {
      return { ok: false, attempts: attempt + 1, lastStatus };
    }
  }
  return { ok: false, attempts: maxRetries + 1, lastStatus };
}

/**
 * 配送の結果を記録する。
 *
 * 連続失敗の回数を持つのは、運用側が「いつから壊れているか」を
 * 画面で気づけるようにするため。自動では止めない。黙って止まる方が、
 * 送られていないことに気づくのが遅れる。
 */
export async function recordDeliveryOutcome(
  db: D1Database,
  webhookId: string,
  ok: boolean,
): Promise<void> {
  if (ok) {
    await db
      .prepare(
        `UPDATE outgoing_webhooks
            SET consecutive_failures = 0, last_failed_at = NULL
          WHERE id = ? AND consecutive_failures != 0`,
      )
      .bind(webhookId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE outgoing_webhooks
          SET consecutive_failures = consecutive_failures + 1,
              last_failed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(webhookId)
    .run();
}
