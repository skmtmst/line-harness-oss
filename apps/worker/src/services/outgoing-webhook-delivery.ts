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
 */

export type WebhookDnsLookup = (host: string) => Promise<string[]>;

export type WebhookBlockReason =
  | 'invalid_url'
  | 'non_https'
  | 'credentials_in_url'
  | 'blocked_host'
  | 'blocked_ip';

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

function isBlockedIpv6Literal(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fec0:')) return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('ff')) return true;
  if (h.startsWith('64:ff9b:')) return true;
  if (h === '2001:db8::' || h.startsWith('2001:db8:')) return true;
  // ::ffff:127.0.0.1 のような IPv4 射影は中の IPv4 で判断する。
  if (h.startsWith('::ffff:')) {
    const tail = h.slice('::ffff:'.length);
    if (tail.includes('.')) {
      const bytes = ipv4ToBytes(parseIpv4Parts(tail) ?? []);
      if (!bytes) return true;
      return isBlockedIpv4Bytes(bytes);
    }
    const groups = tail.split(':').filter((g) => g.length > 0);
    if (groups.length !== 2 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return true;
    const v = (parseInt(groups[0], 16) << 16) | parseInt(groups[1], 16);
    return isBlockedIpv4Bytes([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
  }
  return false;
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
  if (!res.ok) return [];
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
  try {
    const [a, aaaa] = await Promise.all([
      dohQuery(host, 'A', fetchImpl),
      dohQuery(host, 'AAAA', fetchImpl),
    ]);
    return [...a, ...aaaa];
  } catch {
    // 名前を引けないときは文字面の検査だけにする。送ってみて繋がらなければ
    // 接続失敗として台帳に残る。
    return [];
  }
}

export interface WebhookSafetyOptions {
  lookupHost?: WebhookDnsLookup;
  fetchImpl?: typeof fetch;
}

export type WebhookSafetyVerdict = { ok: true } | { ok: false; reason: WebhookBlockReason };

/**
 * 送信直前の再検査。文字面の検査に加え、名前はその場で引き直して
 * 1件でも内部・private 側のIPが混ざっていたら止める。
 */
export async function checkWebhookUrlSafety(
  value: string,
  opts: WebhookSafetyOptions = {},
): Promise<WebhookSafetyVerdict> {
  const literal = webhookUrlBlockReason(value);
  if (literal) return { ok: false, reason: literal };
  const host = normalizeHostname(value);
  if (!host) return { ok: false, reason: 'invalid_url' };
  if (host.includes(':') || ipv4ToBytes(parseIpv4Parts(host) ?? [])) return { ok: true };
  const lookup = opts.lookupHost ?? ((h) => defaultLookupHost(h, opts.fetchImpl ?? fetch));
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: true };
  }
  for (const address of addresses) {
    const reason = ipAddressBlockReason(address);
    if (reason) return { ok: false, reason };
  }
  return { ok: true };
}

export interface SafePostOptions {
  fetchImpl?: typeof fetch;
  lookupHost?: WebhookDnsLookup;
  maxRedirects?: number;
}

export type SafePostOutcome = { response: Response } | { blocked: WebhookBlockReason };

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * 転送を1段ずつ手で辿りながら送る。転送先も送る前に再検査する。
 * 転送の段数が上限を超えたら最後の応答をそのまま返す(3xxは失敗扱い)。
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
  let body: string | undefined = init.body;
  let hop = 0;
  for (;;) {
    const safety = await checkWebhookUrlSafety(current, {
      lookupHost: opts.lookupHost,
      fetchImpl,
    });
    if (!safety.ok) return { blocked: safety.reason };
    const response = await fetchImpl(current, {
      method,
      headers: init.headers,
      body,
      redirect: 'manual',
      signal: init.signal,
    });
    if (!REDIRECT_STATUS.has(response.status) || hop >= maxRedirects) return { response };
    const location = response.headers?.get?.('location');
    if (!location) return { response };
    try {
      current = new URL(location, current).toString();
    } catch {
      return { response };
    }
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
