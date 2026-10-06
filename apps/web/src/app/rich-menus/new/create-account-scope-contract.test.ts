import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CREATE = readFileSync(join(HERE, 'create-v8.tsx'), 'utf8')

/**
 * R23・m18r を V8 の作る画面で引き継ぐ（v7 作る本体は 2026-10-05 に撤去）。
 * 面の動きのタグ・テンプレート候補は、いま選んでいるアカウントのものだけを
 * 取る。候補の選択欄自体は共通 AreaProperties が持つ。
 */
describe('作る画面の候補は選択アカウントで絞る（R23・m18r）', () => {
  it('タグ一覧の取得に選択アカウントを付ける', () => {
    expect(CREATE).toContain('api.tags.list(accountId ? { accountId } : undefined)')
  })

  it('テンプレート一覧の取得に選択アカウントを付ける', () => {
    expect(CREATE).toContain('api.templates.list(undefined, accountId ?? undefined)')
  })

  it('取った候補を面の動きの欄へ渡す', () => {
    expect(CREATE).toContain('tags={tags}')
    expect(CREATE).toContain('templates={templates}')
  })
})
