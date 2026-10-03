import { describe, expect, it } from 'vitest';
import { renderMailHtml } from './mail-html.js';

describe('renderMailHtml', () => {
  it('musubo の名前と見出し・本文を出す', () => {
    const html = renderMailHtml({
      heading: '管理画面への招待',
      lead: '坂本 様',
      paragraphs: ['管理画面へ招待されました。'],
    });
    expect(html).toContain('musubo');
    expect(html).toContain('管理画面への招待');
    expect(html).toContain('坂本 様');
    expect(html).toContain('管理画面へ招待されました。');
  });

  it('文字をそのまま出さずHTMLの意味を消す', () => {
    const html = renderMailHtml({
      heading: '確認',
      paragraphs: ['<script>alert(1)</script> & "引用"'],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('改行は <br /> にする', () => {
    const html = renderMailHtml({ heading: '確認', paragraphs: ['1行目\n2行目'] });
    expect(html).toContain('1行目<br />2行目');
  });

  it('ボタンとURLの貼り付け案内を出す', () => {
    const html = renderMailHtml({
      heading: '確認',
      paragraphs: ['下のボタンから進んでください。'],
      action: { label: 'メールアドレスを確認する', url: 'https://example.test/staff/invite#invite=abc' },
    });
    expect(html).toContain('href="https://example.test/staff/invite#invite=abc"');
    expect(html).toContain('メールアドレスを確認する');
    expect(html).toContain('ブラウザに貼り付けてください');
  });

  it('http(s) でない行き先はボタンを出さない', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', '/relative', '']) {
      const html = renderMailHtml({ heading: '確認', paragraphs: ['本文'], action: { label: '開く', url } });
      expect(html).not.toContain('<a href');
      expect(html).not.toContain('開く');
    }
  });

  it('注意書きは省略できる', () => {
    const withNote = renderMailHtml({ heading: '確認', paragraphs: ['本文'], notes: ['有効期限は7日間です。'] });
    expect(withNote).toContain('有効期限は7日間です。');
    const withoutNote = renderMailHtml({ heading: '確認', paragraphs: ['本文'] });
    expect(withoutNote).not.toContain('有効期限');
  });
});
