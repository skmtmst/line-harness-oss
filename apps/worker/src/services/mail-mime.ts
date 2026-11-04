import { NEN_FROM_NAME } from './mail-from-name.js';

/*
 * 送るメールの中身を組み立てるだけの部品。
 * 通信（cloudflare:sockets）を使わないので、ここだけ試験で確かめられる。
 */

export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') || '';
}

export function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export type MailMimeInput = {
  to: string;
  from: string;
  subject: string;
  body: string;
  /** 飾り付きの本文。あれば body と両方を1通に入れる（multipart/alternative）。 */
  html?: string;
  /** 差出人の表示名。省略時は 然-NEN- の窓口名。 */
  fromName?: string;
  inReplyTo?: string;
  references?: string;
};

export type MailMimeMeta = {
  messageId: string;
  /** multipart のときの区切り線。html が無いときは使わない。 */
  boundary: string;
  date: string;
};

/**
 * SMTP の DATA で送る「見出し＋本文」を作る。終わりの「.」は付けない。
 *
 * html があるときだけ multipart/alternative にする。無いときの出力は
 * 以前とまったく同じ（text/plain + base64 の1つだけ）。
 */
export function buildMailData(input: MailMimeInput, meta: MailMimeMeta): string {
  const headers = [
    `Date: ${meta.date}`,
    `Message-ID: ${meta.messageId}`,
    `From: =?UTF-8?B?${encodeBase64(safeHeader(input.fromName || NEN_FROM_NAME))}?= <${safeHeader(input.from)}>`,
    `To: <${safeHeader(input.to)}>`,
    `Reply-To: <${safeHeader(input.from)}>`,
    `Subject: =?UTF-8?B?${encodeBase64(safeHeader(input.subject))}?=`,
    ...(input.inReplyTo ? [`In-Reply-To: ${safeHeader(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${safeHeader(input.references)}`] : []),
    'MIME-Version: 1.0',
    ...(input.html
      ? [`Content-Type: multipart/alternative; boundary="${meta.boundary}"`]
      : ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64']),
  ];
  /*
   * 飾り付きの本文があるときは、文字の本文と2つ入れて相手に選ばせる。
   * 並び順は決まりで、後ろにあるものが優先される。HTMLを後ろに置く。
   * 本文は base64 なので行頭が「.」にならず、区切り線は「--」で始まる。
   * SMTP の終わりの「.」と間違われない。
   */
  const payload = input.html
    ? [
      `--${meta.boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      foldBase64(encodeBase64(input.body)),
      `--${meta.boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      foldBase64(encodeBase64(input.html)),
      `--${meta.boundary}--`,
    ].join('\r\n')
    : foldBase64(encodeBase64(input.body));
  return `${headers.join('\r\n')}\r\n\r\n${payload}`;
}
