import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(process.cwd(), 'src/app/tags/new/page.tsx'), 'utf8')
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
})
