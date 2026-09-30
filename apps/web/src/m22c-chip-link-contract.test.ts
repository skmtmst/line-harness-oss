import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * m22c：札の折り返し・行き先リンクの見た目そろえ。見た目の自動点検
 * （design-lint k=5 札の折り返し・k=10 行き先リンクの見た目）で残って
 * いた崩れの戻し検知。直しを戻すと赤くなる。
 */
function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8')
}

describe('m22c 札・ボタンの折り返し', () => {
  it('受信箱の上の行は札も操作も高さ32で1行（言葉は変えない）', () => {
    const source = read('app/chats/page.tsx')
    // 札3つは h-8（32px）。py-1.5（約30px）に戻すと上端がずれて2行に見える。
    expect(source).toContain('inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-pill border')
    // 右の操作も compact（32px）でそろえる。
    expect(source).toContain('保存した検索')
    expect(source).not.toContain('<Button href="/tags?tab=marks" className="h-10 shrink-0">')
  })

  it('定期レポート作成の下の3操作は短い言葉・同じ高さで1行', () => {
    const source = read('app/analytics/reports/new/page.tsx')
    expect(source).toContain('>今すぐ1回だけ送る</Button>')
    expect(source).not.toContain('>いますぐ1回だけ送ってみる</Button>')
    // キャンセルは隣のボタンと同じ高さ40。
    expect(source).toContain('inline-flex h-10 items-center px-3 text-sm no-underline')
  })

  it('条件の足し口は15札を並べない（共通部品で検索式に）', () => {
    const source = read('components/shared/condition-builder.tsx')
    expect(source).toContain('aria-label="追加する条件を選ぶ"')
    expect(source).toContain('<KindPicker')
    // 種類ごとの札ボタンに戻っていたら赤。
    expect(source).not.toContain('{kind.label}')
  })
})

describe('m22c 行き先リンクの見た目', () => {
  it('ダッシュボードの「順路を見る」はカード見出しの行き先リンクと同じ', () => {
    const source = read('components/dashboard/getting-started-band.tsx')
    expect(source).toContain('text-status-info inline-flex shrink-0 items-center gap-1 text-label font-semibold hover:underline')
    expect(source).not.toContain('順路を見る\n      </Link>')
  })

  it('分類案内の行き先リンクは共通の見た目（13px/600青文字）', () => {
    const source = read('components/friend-fields/attribute-kind-guide.tsx')
    expect(source).toContain('text-status-info mt-0.5 inline-block text-label font-semibold hover:underline')
    expect(source).not.toContain('font-semibold text-action')
  })

  it('タグ系の見出し行の戻りはボタン枠ではなく共通の行き先リンク', () => {
    for (const rel of [
      'app/tags/fields/new/page.tsx',
      'app/tags/fields/edit/page.tsx',
      'app/tags/fields/migrate/page.tsx',
      'components/friend-fields/support-mark-editor.tsx',
    ]) {
      const source = read(rel)
      expect(source, `${rel} に共通の行き先リンクが無い`).toContain('text-status-info shrink-0 text-label font-semibold hover:underline')
    }
    expect(read('app/tags/fields/new/page.tsx')).not.toContain('>友だち情報欄へ</Button>')
    expect(read('app/tags/fields/edit/page.tsx')).not.toContain('>友だち情報欄へ</Button>')
    expect(read('app/tags/fields/migrate/page.tsx')).not.toContain('>友だち情報欄へ</Button>')
    expect(read('components/friend-fields/support-mark-editor.tsx')).not.toContain('>対応マークへ</Button>')
  })
})
