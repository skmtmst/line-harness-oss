import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CardHeader } from './card'
import Notice from './notice'
import StatusBadge from './status-badge'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const GLOBALS = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8')

const read = (name: string) => readFileSync(join(HERE, name), 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * #669 緑の意味は2つだけ——主操作（CTA）と成功・有効状態。
 *
 * 緑が「押せるもの」と「ただの情報」の両方に使われ、主操作が埋もれて
 * いた。役割とトークンの対応は `globals.css` の #669 注釈が正本。
 * この試験は共有部品（shared・layout）の出口を見張る。画面個別の
 * 残り（緑リンク100か所・生Tailwind色など）は Issue #669 の残件表へ。
 */

function token(name: string): string {
  const match = GLOBALS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`))
  if (!match) throw new Error(`--color-${name} が見つからない`)
  return match[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function block(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*{([^}]*)}`))
  if (!match) throw new Error(`${selector} が見つからない`)
  return match[1]
}

describe('#669 カード頭の緑を整理する', () => {
  it('操作リンクはリンク色（action）、補足はニュートラル', () => {
    const css = withoutComments(read('card.module.css'))
    expect(block(css, '.action')).toMatch(/color:\s*var\(--color-action\)/)
    expect(block(css, '.action')).not.toMatch(/accent/)
    expect(block(css, '.meta')).toMatch(/color:\s*var\(--color-ink-secondary\)/)
    expect(block(css, '.meta')).not.toMatch(/accent|success/)
  })

  it('実Reactで描いたカード頭に操作と補足が出る', () => {
    const html = renderToStaticMarkup(
      <CardHeader title="対応状況" meta="3件" action={<a href="/chats">受信箱へ</a>} />,
    )
    expect(html).toContain('対応状況')
    expect(html).toContain('3件')
    expect(html).toContain('href="/chats"')
  })
})

describe('#669 成功の緑を success に1本化する', () => {
  it('札と通知の成功文字は success、地は success-bg', () => {
    for (const name of ['status-badge.module.css', 'notice.module.css']) {
      const css = withoutComments(read(name))
      expect(block(css, '.success')).toMatch(/color:\s*var\(--color-success\)/)
      expect(block(css, '.success')).toMatch(/background:\s*var\(--color-success-bg\)/)
    }
  })

  it('実Reactで描いた成功の札と通知に文が出る', () => {
    const html = renderToStaticMarkup(
      <div>
        <StatusBadge tone="success">送信完了</StatusBadge>
        <Notice tone="success" message="保存しました" />
      </div>,
    )
    expect(html).toContain('送信完了')
    expect(html).toContain('保存しました')
  })
})

describe('#669 共有部品に生の緑・青を書かない', () => {
  it('shared・layout の画面コードに Tailwind の生色が無い', () => {
    const hits: string[] = []
    for (const dir of [join(SRC, 'components', 'shared'), join(SRC, 'components', 'layout')]) {
      const walk = (d: string) => {
        for (const name of readdirSync(d)) {
          const path = join(d, name)
          if (statSync(path).isDirectory()) walk(path)
          else if (/\.(tsx|css)$/.test(name) && !name.includes('.test.')) {
            const body = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
            for (const [i, line] of body.split('\n').entries()) {
              if (/(?<![\w-])(?:[a-z-]+:)?(?:text|bg|bg-gradient|border|ring|divide|outline|decoration|from|via|to)-(?:green|emerald|teal|lime|sky|blue)-(?:50|100|200|300|400|500|600|700|800|900)(?![\w-])/.test(line)) {
                hits.push(`${path.replace(SRC, '')}:${i + 1}: ${line.trim().slice(0, 60)}`)
              }
            }
          }
        }
      }
      walk(dir)
    }
    expect(hits, 'セマンティックトークンにしてください').toEqual([])
  })
})

describe('#669 変えた組み合わせは AA（4.5:1）を満たす', () => {
  it.each([
    ['action（カード頭リンク）', 'action', 'canvas'],
    ['ink-secondary（カード頭補足）', 'ink-secondary', 'canvas'],
    ['success（成功の札・通知）', 'success', 'success-bg'],
    ['success（成功文・白地）', 'success', 'canvas'],
    ['status-info（更新告知）', 'status-info', 'status-info-soft'],
  ])('%s', (_label, text, surface) => {
    expect(contrast(token(text), token(surface))).toBeGreaterThanOrEqual(4.5)
  })
})
