import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(process.cwd(), 'src/components/friend-fields/new-tag-page-v4.tsx'), 'utf8')
const ROUTE = fs.readFileSync(path.join(process.cwd(), 'src/app/tags/new/page.tsx'), 'utf8')
const LIST = fs.readFileSync(path.join(process.cwd(), 'src/components/friend-fields/tags-page-v4.tsx'), 'utf8')
const EDITOR = fs.readFileSync(path.join(process.cwd(), 'src/components/friend-fields/tag-editor-v4.tsx'), 'utf8')
const API = fs.readFileSync(path.join(process.cwd(), 'src/lib/api.ts'), 'utf8')

describe('タグ作成の名前検査の契約', () => {
  it('作る前に長さと使えない文字を見る', () => {
    expect(PAGE).toContain('タグ名は80文字までで入力してください')
    expect(PAGE).toContain('タグ名に使えない文字が含まれています')
  })

  it('タグの更新に色を渡さない', () => {
    /* タグ自身は色を持たない。色は分類(フォルダ)に付ける。 */
    expect(API).toContain('update: (id: string, data: { name?: string; isStarred?: boolean })')
    expect(API).not.toContain('data: { name?: string; color?: string; isStarred?: boolean }')
  })

  it('旧作成画面を残さず、一覧と複製から現行V4作成画面へ進む', () => {
    expect(ROUTE).toContain("import NewTagPageV4 from '@/components/friend-fields/new-tag-page-v4'")
    expect(ROUTE).toContain('<NewTagPageV4 />')
    expect(ROUTE).not.toContain('LegacyNewTagPage')
    expect(ROUTE).not.toContain('CreatePage')
    expect(LIST).toContain('<Button href="/tags/new" variant="primary">＋ タグを追加</Button>')
    expect(EDITOR).toContain('href={`/tags/new?copy=${tag?.id ?? \'\'}`}')
  })

  it('現行V4作成画面が旧画面の保存項目を引き継ぐ', () => {
    expect(PAGE).toContain('api.tags.createDefinition(')
    expect(PAGE).toContain('groupId: values.groupId || null')
    expect(PAGE).toContain('isStarred: values.isStarred')
    expect(PAGE).toContain('mileage: { self: values.rewardMiles, referrer: values.referralRewardMiles')
    expect(PAGE).toContain('actions: definitionsForSave(values.actions)')
  })
})
