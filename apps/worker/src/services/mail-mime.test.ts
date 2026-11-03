import { describe, expect, it } from 'vitest';
import { buildMailData, encodeBase64 } from './mail-mime.js';

/*
 * 受入条件5: 送る口に飾り付きの本文（html）を通せるようにする。
 * html が無いときの中身は以前とまったく同じであること。
 */

const META = { messageId: '<id@nen-petfood.com>', boundary: 'nen-test-boundary', date: 'Fri, 03 Oct 2026 00:00:00 GMT' };

const BASE = {
  to: 'to@example.com',
  from: 'from@example.com',
  subject: '【musubo】お知らせ',
  body: 'ここが文字の本文です。',
};

/** 最初の空行で見出しと本文に分ける。本文の中にも空行があるので split は使えない。 */
function split(data: string): { headers: string; payload: string } {
  const at = data.indexOf('\r\n\r\n');
  return { headers: data.slice(0, at), payload: data.slice(at + 4) };
}

function decode(base64: string): string {
  const binary = atob(base64.replace(/\r\n/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

describe('buildMailData', () => {
  it('html が無いときは text/plain の1つだけで、区切り線を入れない', () => {
    const data = buildMailData(BASE, META);
    const { headers, payload } = split(data);

    expect(headers).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(headers).toContain('Content-Transfer-Encoding: base64');
    expect(headers).not.toContain('multipart/alternative');
    expect(data).not.toContain(META.boundary);
    expect(payload).toBe(encodeBase64(BASE.body));
    expect(decode(payload)).toBe(BASE.body);
  });

  it('html があるときは multipart/alternative にして文字と飾りを両方入れる', () => {
    const html = '<p>ここが飾り付きの本文です。</p>';
    const data = buildMailData({ ...BASE, html }, META);
    const { headers, payload } = split(data);

    expect(headers).toContain(`Content-Type: multipart/alternative; boundary="${META.boundary}"`);
    // 見出しの側に本文の型を書いてしまうと、受け取る側が分けられない。
    expect(headers).not.toContain('Content-Transfer-Encoding: base64');

    const parts = payload.split(`--${META.boundary}`);
    // ['', 文字の部分, 飾りの部分, '--']
    expect(parts).toHaveLength(4);
    expect(parts[3]).toBe('--');

    expect(parts[1]).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(decode(split(parts[1].slice(2)).payload)).toBe(BASE.body);

    // 飾り付きは後ろに置く。多くのメールソフトは後ろを優先して表示する。
    expect(parts[2]).toContain('Content-Type: text/html; charset=UTF-8');
    expect(decode(split(parts[2].slice(2)).payload)).toBe(html);
  });

  it('本文は base64 なので、行頭の「.」や区切り線がそのまま出ない', () => {
    const data = buildMailData({ ...BASE, body: '.\r\n--nen-test-boundary\r\n.', html: '<p>.</p>' }, META);
    const { payload } = split(data);
    // 区切り線は組み立てた3本だけ（開始2本＋終了1本）。
    expect(payload.match(/^--nen-test-boundary/gm)).toHaveLength(3);
    expect(payload.split('\r\n').filter((line) => line === '.')).toHaveLength(0);
  });

  it('差出人の表示名を渡すとそれを使い、省略すると 然-NEN- の窓口名になる', () => {
    const named = buildMailData({ ...BASE, fromName: 'musubo' }, META);
    expect(named).toContain(`From: =?UTF-8?B?${encodeBase64('musubo')}?= <from@example.com>`);

    const fallback = buildMailData(BASE, META);
    expect(fallback).toContain(`From: =?UTF-8?B?${encodeBase64('然-NEN- お客様窓口')}?= <from@example.com>`);
  });

  it('見出しに改行を混ぜられても1行に戻す', () => {
    const data = buildMailData({ ...BASE, to: 'to@example.com\r\nBcc: spy@example.com' }, META);
    expect(data).toContain('To: <to@example.com Bcc: spy@example.com>');
    expect(data).not.toContain('\r\nBcc:');
  });
});
