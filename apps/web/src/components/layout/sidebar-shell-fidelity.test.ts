import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * V8 殻合わせ（絵 `V8-B/JKjsE`・オーナー 2026-10-07「統括の方が全然良くない」）。統括の脇の頭と下：
 * 頭は店の画面と同じ部品（会社の印＋会社名＋小さく musubo）。
 * 下は店の画面と同じく「統括の設定」（歯車）と版。左下のアカウントの行は v7 だけ。
 * v7 の札・v7 の下は変えない。動き（出る・出ない）は v8-sidebar-groups.react.test.tsx が描いて確かめる。
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'sidebar.tsx'), 'utf8');

describe('V8 統括の脇の頭と下（殻合わせ）', () => {
  it('頭は店の画面と同じ部品（v7 の札は残す）', () => {
    expect(source).toContain('統括コンソール')
    expect(source).toContain('<div className="v8-only"><SidebarIdentity /></div>')
  })

  it('統括の下は「統括の設定」の入口（店舗側の「設定」は残す）', () => {
    expect(source).toContain('href="/hq/settings"')
    expect(source).toContain('href="/settings"')
  })

  it('版は v7 の統括だけ出さない', () => {
    expect(source).toContain('{preview || (isHq && !isV8) ? null : <div className={styles.collapseHide}><SidebarVersion /></div>}')
  })
});
