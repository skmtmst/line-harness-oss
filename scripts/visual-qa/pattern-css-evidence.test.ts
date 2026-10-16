import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error 監査の実装はJS。
import { run } from './v8-pattern-audit.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function findings(jsx: string, selector = '.state[data-state="on"]', extra = '') {
  const root = mkdtempSync(join(tmpdir(), 'pattern-css-consumer-'))
  roots.push(root)
  const put = (file: string, text: string) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  put('apps/web/src/v8/demo/page.tsx', `import styles from './page.module.css';
    import { Button } from '@/components/shared/button';
    ${extra}
    export const Page = () => (${jsx})`)
  put('apps/web/src/v8/demo/page.module.css', `${selector} { color: var(--color-ink); }`)
  const report = run({ code: root })
  return (Object.values(report.code.b).flat() as { kind: string }[]).filter(hit => hit.kind === 'css')
}

describe('CSSの使い先による所有監査', () => {
  it('素の要素だけに当たる選択子は数えない', () => {
    expect(findings('<button className={styles.state} data-state="on">実行</button>')).toHaveLength(0)
    expect(findings('<div className={styles.state}><button>実行</button></div>', '.state button')).toHaveLength(0)
  })
  it('共通部品に当たる選択子は数える', () => {
    expect(findings('<Button className={styles.state}>実行</Button>')).not.toHaveLength(0)
    expect(findings('<div className={styles.state}><Button>実行</Button></div>', '.state button')).not.toHaveLength(0)
  })
  it.each([
    ':global(.state)[data-state="on"]',
    '.state :global button[data-state="on"]',
    '.state:has(button)[data-state="on"]',
    '.unknown[data-state="on"]',
  ])('判断できない選択子は数える: %s', selector => {
    expect(findings('<button className={styles.state}>実行</button>', selector)).not.toHaveLength(0)
  })
  it('同じクラスの使い先に共通部品が1つでもあれば数える', () => {
    expect(findings('<><button className={styles.state}>実行</button><Button className={styles.state}>実行</Button></>')).not.toHaveLength(0)
  })
  it('変数経由の共通部品・使い先不明の参照を素の要素の証拠で消さない', () => {
    expect(findings('<button className={styles.state}>実行</button>', undefined,
      'const unknown = styles.state; export const Other = () => <Button className={unknown} />')).not.toHaveLength(0)
  })
  it('動的な子の中身が分からなければ子孫への指定を数える', () => {
    expect(findings('<div className={styles.state}>{content}</div>', '.state button')).not.toHaveLength(0)
  })
  it('小文字で始まる名前空間の部品を素のタグと誤認しない', () => {
    expect(findings('<ui.Button className={styles.state}>実行</ui.Button>')).not.toHaveLength(0)
  })
})
