import { readUiSource } from '../../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const EDIT = readUiSource(join(process.cwd(), 'src/v8/reminders/edit.tsx'), 'utf8')
const CSS = readUiSource(join(process.cwd(), 'src/v8/reminders/edit.module.css'), 'utf8')
const FRAME = readFileSync(join(process.cwd(), 'src/components/templates/page-templates.module.css'), 'utf8')
const TOKENS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

describe('通知ステップ編集の中幅レイアウト', () => {
  it('狭い板は現在の型で右のスマホを畳み、本文を保つ', () => {
    expect(EDIT).toContain('preview={narrow ?')
    expect(EDIT).toContain('<DetailPanel open={phoneOpen}')
    expect(FRAME).toContain('@container v8-page (max-width: 1099px)')
    expect(FRAME).toContain('.preview { width: var(--tpl-preview-narrow-width);')
  })

  it('送信時刻の欄は採用済みの幅を使い、行を安全に折り返す', () => {
    expect(CSS).toContain('.timingTime { width: var(--tpl-rm-time-w); }')
    expect(TOKENS).toContain('--tpl-rm-time-w: 140px')
    expect(CSS).toContain('.timingRow { display: flex; flex-wrap: wrap;')
  })
})
