import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LIFF の初期化中を白い画面にしない（リリース前点検 2026-10-07）。
 * main.tsx は initLiff() が終わるまで描かないので、index.html の #root に骨組みを先に置く。
 */
describe('起動中の骨組み', () => {
  const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

  it('#root は空でなく、読み込み中の骨組みを持つ', () => {
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script/);
    expect(root?.[1]).toContain('class="boot"');
    expect(root?.[1]).toContain('aria-busy="true"');
  });

  it('0.3 秒以内に開けたら見せない（点滅させない）・検索に出さない', () => {
    expect(html).toMatch(/animation:boot-in 0s linear \.3s forwards/);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
  });
});
