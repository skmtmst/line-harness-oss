/*
 * musubo 名義のメールの、飾り付きの本文を作るところ。
 *
 * メールソフトは今のCSSをほとんど読まない。だから見た目は table と
 * 要素ごとの style で作る。class や <style> は使わない。
 * 画像も使わない。多くのメールソフトが既定で画像を止めるので、
 * 止められた状態で意味が通らなくなる作りにしない。
 *
 * 文字だけの本文（sendPlainMail の body）はこの部品では作らない。
 * 同じ内容を2通りに書くと片方だけ直す事故が起きるので、呼ぶ側が
 * 文字の本文を正本として持ち、ここへ同じ材料を渡す。
 */

const BRAND = 'musubo';
const INK = '#24292f';
const INK_SOFT = '#5b6470';
const ACCENT = '#06c755';
const HAIRLINE = '#e3e6ea';
const CANVAS = '#f6f7f9';

/** HTMLに置くときに意味を持ってしまう文字を、見た目そのままの字に直す。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/*
 * ボタンの行き先。確認リンクは自分たちが組み立てた http(s) のURLだけを
 * 通す。javascript: などを href に入れられると、読んだ人の手元で別の
 * ことが起きる。通せない値のときはボタンを出さない。
 */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) return null;
  return trimmed;
}

/** 文字の本文と同じ改行の入れ方で段落を出す。 */
function paragraph(text: string, color: string, size: string): string {
  const html = escapeHtml(text).replace(/\n/g, '<br />');
  return `<p style="margin:0 0 14px;color:${color};font-size:${size};line-height:1.8;">${html}</p>`;
}

export type MailHtmlInput = {
  /** 見出し。件名の【musubo】を外したものを入れることが多い。 */
  heading: string;
  /** 宛名など、見出しのすぐ下に出す1行。 */
  lead?: string;
  /** 本文。1つずつ段落になる。 */
  paragraphs: string[];
  /** 押させたいもの。URLが http(s) でないときは出さない。 */
  action?: { label: string; url: string };
  /** 有効期限や注意など、小さく出す行。 */
  notes?: string[];
};

export function renderMailHtml(input: MailHtmlInput): string {
  const url = input.action ? safeUrl(input.action.url) : null;
  const button = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">`
      + `<tr><td style="border-radius:8px;background:${ACCENT};">`
      + `<a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;color:#ffffff;`
      + `font-size:15px;font-weight:bold;text-decoration:none;">${escapeHtml(input.action!.label)}</a>`
      + `</td></tr></table>`
      // ボタンが押せないメールソフト向けに、URLそのものも残す。
      + `<p style="margin:0 0 14px;color:${INK_SOFT};font-size:12px;line-height:1.7;word-break:break-all;">`
      + `ボタンが押せないときは、次のURLをブラウザに貼り付けてください。<br />`
      + `${escapeHtml(url)}</p>`
    : '';

  const notes = (input.notes ?? [])
    .map((note) => paragraph(note, INK_SOFT, '12px'))
    .join('');

  return [
    '<!doctype html>',
    '<html lang="ja"><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(input.heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CANVAS};`,
    `font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN',system-ui,sans-serif;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">`,
    '<tr><td align="center" style="padding:28px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"',
    ` style="max-width:560px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px;">`,
    `<tr><td style="padding:26px 28px 0;">`,
    `<p style="margin:0;color:${ACCENT};font-size:13px;font-weight:bold;letter-spacing:.04em;">${BRAND}</p>`,
    `<h1 style="margin:10px 0 18px;color:${INK};font-size:20px;line-height:1.5;">${escapeHtml(input.heading)}</h1>`,
    '</td></tr>',
    '<tr><td style="padding:0 28px 26px;">',
    input.lead ? paragraph(input.lead, INK, '15px') : '',
    input.paragraphs.map((text) => paragraph(text, INK, '15px')).join(''),
    button,
    notes,
    '</td></tr></table>',
    `<p style="margin:16px 0 0;color:${INK_SOFT};font-size:11px;line-height:1.7;">`,
    `このメールは ${BRAND} から送られています。</p>`,
    '</td></tr></table></body></html>',
  ].join('');
}
