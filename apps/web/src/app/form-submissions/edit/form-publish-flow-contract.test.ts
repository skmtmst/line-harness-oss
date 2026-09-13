import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

describe('回答フォームの下書きと公開を分ける', () => {
  it('保存と公開を別の操作として表示する', () => {
    expect(source).toContain("onClick={() => void save(false)}")
    expect(source).toContain('下書きを保存')
    expect(source).toContain("onClick={() => void save(true)}")
    expect(source).toContain('この版を公開')
  })

  it('未公開の下書きは保存だけで受付中にせず、公開APIを明示的に呼ぶ', () => {
    expect(source).toContain('isActive: publishedVersionId ? isActive : false')
    expect(source).toContain('api.forms.publish(id, selectedAccountId, res.data.contentRevision)')
    expect(source.indexOf('api.forms.update(id, selectedAccountId'))
      .toBeLessThan(source.indexOf('api.forms.publish(id, selectedAccountId'))
  })

  it('下書き保存では公開中の内容が変わらないことを知らせる', () => {
    expect(source).toContain('下書きを保存しました。公開中の内容は変わっていません')
  })
})
