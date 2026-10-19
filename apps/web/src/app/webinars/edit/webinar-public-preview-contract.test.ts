import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const REVIEW = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/review.tsx'), 'utf8')
const VIDEO = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/video.tsx'), 'utf8')
const NOTIFICATIONS = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/notifications.tsx'), 'utf8')
const BUTTON = fs.readFileSync(path.join(__dirname, '../../../components/shared/button.tsx'), 'utf8')
const PAGE = fs.readFileSync(path.join(__dirname, '../../../v8/webinar-edit/edit.tsx'), 'utf8')

describe("管理画面 ウェビナー公開ページ確認の契約", () => {
  it('実ノードと行き先が分かる操作名を持つ', () => {
    expect(REVIEW).toContain('boardId="XCUNf"')
    expect(NOTIFICATIONS).toContain('公開ページを見る')
    expect(PAGE).not.toContain('プレビューは準備中です')
  })

  it('ウェビナー編集APIが検査したLIFF URLだけを使う', () => {
    expect(PAGE).toContain('const publicUrl = editor.publicPage.url')
    expect(PAGE).toContain('webinarApi.editor(id)')
    expect(REVIEW).toContain('webinarApi.testPublicPage(webinar.id, version.current)')
    expect(PAGE).not.toContain('selectedAccountId')
  })

  it('公開中かつLIFF設定済みのときだけ別窓で開く', () => {
    expect(PAGE).toContain("const canOpenPublicPage = webinar.status === 'active' && publicUrl !== null")
    expect(NOTIFICATIONS).toContain('<Button external href={ctx.publicUrl}')
    expect(BUTTON).toContain("target={newTab ? '_blank'")
    expect(BUTTON).toContain("rel={newTab ? 'noopener noreferrer'")
    expect(PAGE).toContain('公開すると、友だちが見るページを確認できます')
    expect(PAGE).toContain('LIFF IDが設定されていません')
    expect(VIDEO).toContain('ctx.canOpenPublicPage && ctx.publicUrl')
    expect(NOTIFICATIONS).toContain('!ctx.canOpenPublicPage && ctx.publicPageReason')
  })

  it('アカウント読込中や所属未取得をLIFF未設定と言い切らない', () => {
    expect(PAGE).toContain('const { accounts, loading: accountsLoading } = useAccount()')
    expect(PAGE).toContain("accountsLoading\n    ? 'LINE公式アカウントを確認しています。'")
    expect(PAGE).toContain('!webinar.accountId || !account')
    expect(PAGE).toContain('このウェビナーのLINE公式アカウントを確認できません')
  })

  it('内部の管理APIやslugだけの相対URLを公開先にしない', () => {
    expect(PAGE).toContain('editor.publicPage.url')
    expect(PAGE).not.toContain('href={`/webinar/${webinar.slug}`')
    expect(PAGE).not.toContain('/api/liff/webinars/${webinar.slug}')
  })
})
