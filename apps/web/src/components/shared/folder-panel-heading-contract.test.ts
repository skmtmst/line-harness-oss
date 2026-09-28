import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * m18s: FolderPanel の見出しには絞り込み後の件数を出さない。
 * 見出しはフォルダの総数か何も出さず、絞り込みの件数は一覧の側に出す
 * （回答フォーム #m18k と同じ形）。登録メディアで「すべて 186」と
 * 「0件」が食い違った例の再発防止。戻すと赤。
 */
const here = dirname(fileURLToPath(import.meta.url))
const src = (...parts: string[]) => readFileSync(join(here, '..', '..', 'app', ...parts), 'utf8')

const contents = src('contents', 'page.tsx')
const vars = src('contents', 'vars', 'page.tsx')
const broadcasts = src('broadcasts', 'page.tsx')

describe('m18s FolderPanelの見出しに絞り込み件数を出さない', () => {
  it('登録メディア・共通情報・一斉配信は見出しの総数を出さない', () => {
    for (const [name, page] of [['contents', contents], ['vars', vars], ['broadcasts', broadcasts]] as const) {
      const panel = page.slice(page.indexOf('<FolderPanel'))
      expect(panel.slice(0, 400)).not.toContain('total=', `${name} の見出しに件数を戻さないこと`)
    }
  })

  it('絞り込み後の件数は一覧の側に出す', () => {
    // 登録メディア: フッターの ListRange（絞り込み後の total）
    expect(contents).toContain('<ListRange total={total}')
    // 共通情報: フッターの ListRange（絞り込み後の filtered.length）
    expect(vars).toContain('<ListRange')
    expect(vars).toContain('total={filtered.length}')
    // 一斉配信: 表の上の ListRange（タイトル・日付で絞った visibleBroadcasts）
    expect(broadcasts).toContain('<ListRange')
    expect(broadcasts).toContain('total={visibleBroadcasts.length}')
  })
})
