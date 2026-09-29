import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const WRAPPER = readFileSync(join(HERE, 'scrollable-tabs.tsx'), 'utf8')
const MERGED = readFileSync(join(HERE, 'merged-tabs.tsx'), 'utf8')
const SRC = join(HERE, '..', '..')
const NEN_MEMBERS = readFileSync(join(SRC, 'app', 'nen', 'members', 'page.tsx'), 'utf8')
const NEN_HEALTH = readFileSync(join(SRC, 'app', 'nen', 'health', 'page.tsx'), 'utf8')
const HQ_MEMBERS = readFileSync(join(SRC, 'app', 'hq', 'members', 'page.tsx'), 'utf8')

/*
 * #975 U091: タブが右にはみ出す画面（/analytics、/search-console、
 * /automations/runs、/nen/members、/nen/health）で、隠れたタブの存在が
 * 伝わらず、深いURLで開くと選択中のタブ自体が見えなかった。
 *
 * 共通部品（components/shared/tabs）はこの案件の所有外なので、
 * 外側にスクロールと端の送りボタンを足す wrapper で対応する。
 */
describe('右に隠れたタブへ届く（#975 U091）', () => {
  it('タブ行は横スクロールでき、はみ出した側へ送るボタンがある', () => {
    expect(WRAPPER).toContain('overflow-x-auto')
    expect(WRAPPER).toContain('w-max min-w-full')
    expect(WRAPPER).toContain('scrollBy')
    expect(WRAPPER).toContain('左側のタブを表示')
    expect(WRAPPER).toContain('右側のタブを表示')
  })

  it('選択中のタブを表示位置へ寄せる（深いURLでも見える）', () => {
    expect(WRAPPER).toContain('[aria-current="page"]')
    expect(WRAPPER).toContain('scrollTo')
  })

  it('キーボードでタブへ移っても見える位置まで追従する', () => {
    expect(WRAPPER).toContain('scrollIntoView')
    expect(WRAPPER).toContain('onFocus')
  })

  it('右端の操作はスクロール領域に入れず、初期位置から押せる', () => {
    // actions は scroller の外に描く（U029/U031 で直した重なりを戻さない）。
    expect(WRAPPER).toContain('shrink-0 items-center gap-2 border-b border-hairline')
    expect(WRAPPER).not.toContain('actions={actions}')
  })

  it('対象画面はすべてスクロールできるタブを使う', () => {
    expect(MERGED).toContain('ScrollableTabs')
    expect(NEN_MEMBERS).toContain('ScrollableTabs')
    expect(NEN_HEALTH).toContain('ScrollableTabs')
    expect(HQ_MEMBERS).toContain('ScrollableTabs')
  })
})
