import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 ウェビナー公開ページ確認の契約', () => {
  it('実ノードと行き先が分かる操作名を持つ', () => {
    expect(PAGE).toContain('data-design-node="GB0NR"')
    expect(PAGE).toContain('公開ページを見る')
    expect(PAGE).not.toContain('プレビューは準備中です')
  })

  it('ウェビナー所属アカウントのLIFFだけを使う', () => {
    expect(PAGE).toContain('accounts.find((account) => account.id === webinar.accountId)')
    expect(PAGE).toContain('webinarAccount?.liffId')
    expect(PAGE).toContain('/webinar/${encodeURIComponent(webinar.slug)}')
    expect(PAGE).not.toContain('selectedAccountId')
  })

  it('公開中かつLIFF設定済みのときだけ別窓で開く', () => {
    expect(PAGE).toContain("webinar.status === 'active' && publicUrl")
    expect(PAGE).toContain('target="_blank"')
    expect(PAGE).toContain('rel="noreferrer"')
    expect(PAGE).toContain('公開すると、友だちが見るページを確認できます')
    expect(PAGE).toContain('LIFF IDが設定されていません')
    expect(PAGE).toContain('<Button data-design-node="GB0NR" disabled')
  })

  it('内部の管理APIやslugだけの相対URLを公開先にしない', () => {
    expect(PAGE).toContain('https://liff.line.me/')
    expect(PAGE).not.toContain('href={`/webinar/${webinar.slug}`')
    expect(PAGE).not.toContain('/api/liff/webinars/${webinar.slug}')
  })
})
