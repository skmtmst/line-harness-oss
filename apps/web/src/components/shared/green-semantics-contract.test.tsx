// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CardHeader } from './card'
import Notice from './notice'
import StatusBadge from './status-badge'
import cardStyles from './card.module.css'
import noticeStyles from './notice.module.css'
import badgeStyles from './status-badge.module.css'
import { contrastRatio, installSharedStyles } from './shared-style-test-support'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
let removeStyles: () => void
beforeAll(async () => { removeStyles = await installSharedStyles([['card', cardStyles], ['notice', noticeStyles], ['status-badge', badgeStyles]]) })
afterAll(() => removeStyles?.())
afterEach(cleanup)

function roleColor(name: string) {
  const probe = document.createElement('span')
  probe.style.color = `var(--color-${name})`
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

describe('補足と成功通知の色を役割に合わせる', () => {
  it('カード頭のリンクと補足に役割の色を描画する', () => {
    render(<CardHeader title="対応状況" meta="3件" action={<a href="/chats">受信箱へ</a>} />)
    const action = screen.getByRole('link', { name: '受信箱へ' })
    const meta = screen.getByText('3件')
    expect(screen.getByText('対応状況')).toBeTruthy()
    expect(action.getAttribute('href')).toBe('/chats')
    expect(getComputedStyle(action).color).toBe(roleColor('action'))
    expect(getComputedStyle(meta).color).toBe(roleColor('ink-secondary'))
    for (const element of [action, meta]) {
      expect(contrastRatio(getComputedStyle(element).color, roleColor('canvas'))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('成功通知は本文を中立色、成功の印を緑で描画する', () => {
    const { container } = render(<Notice tone="success" message="保存しました" />)
    expect(screen.getByText('保存しました')).toBeTruthy()
    const style = getComputedStyle(container.firstElementChild!)
    expect(style.color).toBe(roleColor('ink-secondary'))
    const icon = container.querySelector('svg')!
    expect(getComputedStyle(icon).backgroundColor).toBe(roleColor('success'))
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
  })

  it('成功の札は状態を文字で示し、背景との明暗差を保つ', () => {
    const { container } = render(<StatusBadge tone="success">送信済み</StatusBadge>)
    expect(screen.getByText('送信済み')).toBeTruthy()
    const style = getComputedStyle(container.firstElementChild!)
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('役割ごとの配色は本文の明暗差を保つ', () => {
  it.each([
    ['action', 'canvas'], ['ink-secondary', 'canvas'], ['success', 'success-bg'],
    ['success', 'canvas'], ['status-info-deep', 'status-info-soft'],
  ])('%sと%sは4.5:1以上', (text, surface) => {
    const { container } = render(<span style={{ color: `var(--color-${text})`, backgroundColor: `var(--color-${surface})` }}>配色</span>)
    const style = getComputedStyle(container.firstElementChild!)
    expect(contrastRatio(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('カード頭に主操作や成功専用の変数を流用しない', () => {
  it('操作と補足に禁止された色の変数が入っていない', () => {
    const css = readFileSync(join(HERE, 'card.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const action = css.match(/\.action\s*{([^}]*)}/)![1]
    const meta = css.match(/\.meta\s*{([^}]*)}/)![1]
    expect(action).not.toMatch(/accent/)
    expect(meta).not.toMatch(/accent|success/)
  })
})

describe('共有部品に役割を表す変数を使わず緑・青を直書きしない', () => {
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
