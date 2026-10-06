import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * m18r: リッチメニューの作成・編集のテンプレート候補は、選んでいる
 * アカウントのものだけ（流入リンク #914 と同じ形）。戻すと赤。
 */
const here = dirname(fileURLToPath(import.meta.url))
/* 作るの v7 本体は 2026-10-05 に撤去。候補の取得は `create-v8` が担う。 */
const newPage = readFileSync(join(here, 'create-v8.tsx'), 'utf8')
const editPage = readFileSync(join(here, '..', 'edit', 'page.tsx'), 'utf8')

describe('m18r テンプレート候補は選択accountで絞る', () => {
  it('作成画面は選択accountを付けて取る', () => {
    expect(newPage).toContain('api.templates.list(undefined, accountId ?? undefined)')
  })

  it('編集画面はこのメニューのaccountを付けて取る', () => {
    expect(editPage).toContain('api.templates.list(undefined, group?.accountId ?? undefined)')
  })
})
