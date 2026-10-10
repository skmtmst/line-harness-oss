import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readUiSource(join(HERE, 'page.tsx'), 'utf8')
const NEW_PAGE = readUiSource(join(HERE, 'new/page.tsx'), 'utf8')

describe('送信Webhookの作成経路', () => {
  it('一覧の追加導線を専用フォームへ集め、作成処理を重複させない', () => {
    expect(PAGE).toContain('href="/webhooks/new"')
    expect(readFileSync(new URL('../../v8/webhooks/outgoing.tsx', import.meta.url), 'utf8')).not.toContain('api.webhooks.outgoing.create')
    expect(NEW_PAGE.match(/api\.webhooks\.outgoing\.create/g)).toHaveLength(1)
  })

  it('保存後は既存設定がある一覧へ戻る', () => {
    expect(NEW_PAGE).toContain('href="/webhooks">キャンセル</Button>')
    expect(NEW_PAGE).toContain("router.push(createPageReturnHref('/webhooks', res.data.id))")
  })
})
