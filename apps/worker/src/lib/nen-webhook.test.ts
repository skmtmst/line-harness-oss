import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeHmacSha256Hex, safeEqualHex, verifyNenWebhook, type NenWebhookProfile } from './hmac.js';
import { WEBHOOK_BODY_BYTES, SUPPORT_EMAIL_RAW_MAX_CHARACTERS, isDeclaredWebhookBodyTooLarge, isWebhookBodyTooLarge, utf8Length } from './webhook-body.js';
import { signSupportRelay, verifySupportRelay } from '../services/support-relay.js';

const secret = 'test-secret-for-nen-receivers-only';
const timestamp = '1792200000';
const now = Number(timestamp);
const rawBody = '{"text":"日本語と 🐾","n":1}';
const profiles: NenWebhookProfile[] = ['delivery', 'ec', 'support-relay', 'ec-auto-line'];
const sign = (body = rawBody, time = timestamp, account?: string) => createHmac('sha256', secret)
  .update(account === undefined ? `${time}.${body}` : `${time}.${account}.${body}`).digest('hex');
const check = (profile: NenWebhookProfile, changes = {}) => verifyNenWebhook({
  profile, secret, timestamp, rawBody, nowSeconds: now, signature: sign(), ...changes,
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('共通HMACと一定時間比較', () => {
  it('独立した既知のSHA256ベクトルと一致する', async () => {
    expect(await computeHmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
  it('全桁を比較し、長さ違いと末尾だけの差も断る', () => {
    const hex = sign();
    expect(safeEqualHex(hex, hex)).toBe(true);
    expect(safeEqualHex(hex, hex.slice(1))).toBe(false);
    for (let i = 0; i < 64; i++) {
      expect(safeEqualHex(hex, hex.slice(0, i) + (hex[i] === '0' ? '1' : '0') + hex.slice(i + 1))).toBe(false);
    }
  });
});

for (const profile of profiles) describe(profile, () => {
  it('現在の正当な送信と大文字16進を受け取る', async () => {
    expect(await check(profile)).toEqual({ ok: true });
    expect(await check(profile, { signature: sign().toUpperCase() })).toEqual({ ok: true });
  });
  it('別の鍵・本文の空白追加・末尾改変を断る', async () => {
    for (const changes of [{ secret: 'other-secret' }, { rawBody: rawBody + ' ' }, { signature: sign().slice(0, 63) + 'z' }]) {
      expect(await check(profile, changes)).toEqual({ ok: false, error: 'Invalid signature' });
    }
  });
  it('5分の両端を含み、1秒外の過去/未来を断る', async () => {
    for (const delta of [-301, -300, 300, 301]) {
      const time = String(now + delta);
      expect((await check(profile, { timestamp: time, signature: sign(rawBody, time) })).ok).toBe(Math.abs(delta) <= 300);
    }
  });
  it('非16進・長さ違い・欠落を断る', async () => {
    for (const signature of ['', undefined, 'z'.repeat(64), '_'.repeat(64), sign().slice(1), sign() + '0', ` ${sign()}`]) {
      expect((await check(profile, { signature })).ok).toBe(false);
    }
    for (const timestamp of ['NaN', 'Infinity', '1792200000.5', 'not-time']) {
      expect((await check(profile, { timestamp, signature: sign(rawBody, timestamp) })).ok).toBe(false);
    }
  });
  it('前置きの許可を広げない', async () => {
    expect((await check(profile, { signature: `sha256=${sign()}` })).ok).toBe(profile !== 'support-relay');
    expect((await check(profile, { signature: `SHA256=${sign()}` })).ok).toBe(profile === 'ec' || profile === 'delivery');
  });
});

describe('受信口固有の互換境界', () => {
  it('supportだけ秒を切り捨て、ECと自動LINEは小数秒の経過を保つ', async () => {
    expect((await check('support-relay', { nowSeconds: now + 300.9 })).ok).toBe(true);
    for (const profile of ['ec', 'ec-auto-line'] as const) {
      expect((await check(profile, { nowSeconds: now + 300.001 })).ok).toBe(false);
    }
  });
  it('時刻は数値に作り直さず、受け取った表記そのものを署名へ使う', async () => {
    for (const time of ['01792200000', '1.7922e9', ' 1792200000 ', `0x${now.toString(16)}`]) {
      for (const profile of profiles) {
        const expected = profile === 'support-relay' ? /^\d{10}$/.test(time)
          : profile === 'ec-auto-line' ? /^\d+$/.test(time) : true;
        expect((await check(profile, { timestamp: time, signature: sign(rawBody, time) })).ok).toBe(expected);
      }
    }
  });
  it('自動LINEの既存byte復号の受理結果を狭めない（厳密化は別判断）', async () => {
    // 旧実装は /\w{64}/ を通した後、1桁でparseIntが止まっても同じbyteになる。
    let body = rawBody;
    while (!sign(body).match(/../g)!.some((pair) => pair.startsWith('0'))) body += ' ';
    const digest = sign(body);
    const pairs = digest.match(/../g)!;
    const index = pairs.findIndex((pair) => pair.startsWith('0'));
    expect(index).toBeGreaterThanOrEqual(0);
    pairs[index] = pairs[index][1] + 'g';
    const alias = pairs.join('');
    expect(alias).not.toMatch(/^[0-9a-f]{64}$/i);
    expect((await check('ec-auto-line', { rawBody: body, signature: alias })).ok).toBe(true);
    for (const profile of ['delivery', 'ec', 'support-relay'] as const) {
      expect((await check(profile, { rawBody: body, signature: alias })).ok).toBe(false);
    }
  });
  it('ECのaccount付き署名は同じ宛先だけ、ヘッダー無しは従来の本文署名だけ', async () => {
    expect((await check('ec', { accountId: 'a', signature: sign(rawBody, timestamp, 'a') })).ok).toBe(true);
    expect((await check('ec', { accountId: 'b', signature: sign(rawBody, timestamp, 'a') })).ok).toBe(false);
    expect((await check('ec', { accountId: 'a' })).ok).toBe(false);
    expect((await check('ec', { signature: sign(rawBody, timestamp, 'a') })).ok).toBe(false);
  });
  it('中継の既存公開関数と送信署名の形式を保つ（送信なし）', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now * 1000);
    expect(await signSupportRelay(secret, timestamp, rawBody)).toBe(sign());
    expect(await verifySupportRelay(secret, timestamp, sign().toUpperCase(), rawBody)).toBe(true);
    expect(await verifySupportRelay(secret, timestamp, `sha256=${sign()}`, rawBody)).toBe(false);
  });
});

describe('既存の本文サイズと単位', () => {
  it('受信口ごとの上限を増やさない', () => {
    expect(WEBHOOK_BODY_BYTES).toEqual({ delivery: 131072, ec: 262144, ecAutoLine: 65536 });
    expect(SUPPORT_EMAIL_RAW_MAX_CHARACTERS).toBe(14680064);
  });
  it.each(Object.entries(WEBHOOK_BODY_BYTES))('%s はUTF-8で境界内のみ受け取る', (_name, limit) => {
    for (const size of [limit - 1, limit, limit + 1]) {
      const body = 'あ'.repeat(Math.floor(size / 3)) + 'a'.repeat(size % 3);
      expect(utf8Length(body)).toBe(size);
      expect(isWebhookBodyTooLarge(body, limit)).toBe(size > limit);
    }
  });
  it('content-lengthは以前と同じ数値変換で先に判定し、偽の小さい値は本文検査で断る', () => {
    for (const value of [undefined, '', '-1', 'NaN', 'Infinity', '1']) {
      expect(isDeclaredWebhookBodyTooLarge(value, 64)).toBe(false);
    }
    expect(isDeclaredWebhookBodyTooLarge('64', 64)).toBe(false);
    expect(isDeclaredWebhookBodyTooLarge('65', 64)).toBe(true);
    expect(isDeclaredWebhookBodyTooLarge('6.5e1', 64)).toBe(true);
    expect(isWebhookBodyTooLarge('あ'.repeat(22), 64)).toBe(true);
  });
});
