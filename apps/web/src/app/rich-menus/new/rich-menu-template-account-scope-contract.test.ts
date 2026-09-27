import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * m18r: リッチメニューの作成・編集のテンプレート候補は、選んでいる
 * アカウントのものだけ（流入リンク #914 と同じ形）。戻すと赤。
 */
const here = dirname(fileURLToPath(import.meta.url))
const newPage = readFileSync(join(here, 'page.tsx'), 'utf8')
const editPage = readFileSync(join(here, '..', 'edit', 'page.tsx'), 'utf8')

describe('m18r テンプレート候補は選択accountで絞る', () => {
  it('作成画面は選択accountを付けて取る', () => {
    expect(newPage).toContain('api.templates.list(undefined, selectedAccount?.id ?? undefined)')
  })

  it('編集画面はこのメニューのaccountを付けて取る', () => {
    expect(editPage).toContain('api.templates.list(undefined, group?.accountId ?? undefined)')
  })
})
