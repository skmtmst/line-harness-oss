import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * CreatePoolModal の本体だけを切り出す。引数が分割代入のため、
 * 最初の `{`（引数）ではなく `}) {` の後の本体を見る。
 */
function modalBody(src: string): string {
  const decl = 'function CreatePoolModal('
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} が見つかりません`)
  const paramsClose = src.indexOf('}) {', start)
  if (paramsClose < 0) throw new Error(`${decl} の本体が見つかりません`)
  const open = src.indexOf('{', paramsClose)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`${decl} の本体が閉じていません`)
}

const MODAL = () => modalBody(PAGE)

describe('新規プール窓の常時ラベル (R617)', () => {
  it('3つの欄すべてに常時表示のlabelがある（placeholderだけにしない）', () => {
    const body = MODAL()
    expect(body.match(/<label/g)?.length ?? 0, 'labelが3つない').toBeGreaterThanOrEqual(3)
  })

  it('slugと表示名の入力欄はlabelに包まれている（入力後も項目名が残る）', () => {
    const body = MODAL()
    expect(body, 'slugの欄がlabelに包まれていない').toMatch(/<label[^>]*>[\s\S]*?placeholder="例: brand-a"/)
    expect(body, '表示名の欄がlabelに包まれていない').toMatch(/<label[^>]*>[\s\S]*?placeholder="例: ブランドA"/)
  })

  it('最初の所属アカウントはhtmlForとidで結び付いている', () => {
    const body = MODAL()
    expect(body).toContain('htmlFor="create-pool-account"')
    expect(body).toContain('id="create-pool-account"')
  })

  it('読み上げ名は元からあるので残す（placeholder・aria-labelを消さない）', () => {
    const body = MODAL()
    expect(body, '入力例のplaceholderを消している').toContain('placeholder="例: brand-a"')
    expect(body, '入力例のplaceholderを消している').toContain('placeholder="例: ブランドA"')
    expect(body, 'Selectのaria-labelを消している').toContain('aria-label="最初の所属アカウント"')
  })

  it('slugの意味は「？」に入れ、欄の下に説明文を足さない', () => {
    const body = MODAL()
    expect(body).toContain('<HelpTip label="slugの説明">')
    expect(body).toContain('公開URLに使う識別子です。')
  })
})
