import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const css = readUiSource(join(SRC, 'v8/common-vars/list.module.css'), 'utf8')
const tsx = readUiSource(join(SRC, 'v8/common-vars/list.tsx'), 'utf8')
const tokens = readFileSync(join(SRC, 'app/globals.css'), 'utf8')

describe('V8共通情報の現役の型と数値', () => {
  it('見出しと行は共通の高さ・行余白に従う', () => {
    expect(css).toContain('height: var(--tpl-cv-head-h)')
    expect(css).toContain('height: var(--tpl-cv-row-h)')
    expect(css).toContain('padding-block: var(--tpl-cv-row-pad-block)')
    expect(tokens).toContain('--tpl-cv-row-pad-block: 12px')
  })
  it('列幅は現役の186/96/106を使う', () => {
    expect(css).toContain('.colValue { width: var(--tpl-cv-col-value); }')
    expect(css).toContain('.colState { width: var(--tpl-cv-col-state); }')
    expect(css).toContain('.colUsage { width: var(--tpl-cv-col-usage); }')
    expect(tokens).toContain('--tpl-cv-col-value: 186px; --tpl-cv-col-state: 96px; --tpl-cv-col-usage: 106px')
    expect(tsx).toContain('<Th className={styles.headCell}>中身</Th>')
    expect(tsx).toContain('<Th className={styles.headCell}>状態</Th>')
    expect(tsx).toContain('<Th className={styles.headCell}>使っている所</Th>')
  })
  it('ページ送りの余白は10/20・件数は字の型に従う', () => {
    expect(css).toContain('padding: var(--tpl-cv-pager-pad)')
    expect(tokens).toContain('--tpl-cv-pager-pad: 10px 20px')
    expect(css).toMatch(/\.pagerCount \{[^}]*font-size: var\(--text-label\)/s)
  })
  it('警告の余白10/14・間10、探す欄の幅200を使う', () => {
    expect(css).toContain('padding: var(--tpl-cv-alert-pad)')
    expect(css).toContain('gap: var(--tpl-cv-alert-gap)')
    expect(tokens).toContain('--tpl-cv-alert-gap: 10px; --tpl-cv-alert-pad: 10px 14px')
    expect(css).toContain('--list-search-width: var(--tpl-cv-search-w)')
    expect(tokens).toContain('--tpl-cv-search-w: 200px')
  })
})
