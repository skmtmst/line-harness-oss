import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('V6 友だち追加時配信の契約', () => {
  it('画面名とマニュアルはV6共通トップバーだけに置き、画面固有の操作は残す', () => {
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('title="友だち追加時の配信"')
    expect(PAGE).not.toContain('マニュアル')
    expect(PAGE).toContain('data-design="Head"')
    expect(PAGE).toContain('<TestRunButton accountId={accountId} scenarioName={scenarioName} />')
    expect(PAGE).toContain("{saving ? '保存中…' : '保存'}")
  })

  it('不完全な設定でも保存操作から理由を表示できる', () => {
    expect(PAGE).toContain('const problem = routingError()')
    expect(PAGE).toContain('setError(problem)')
    expect(PAGE).toContain('disabled={saving}')
    expect(PAGE).not.toContain("disabled={saving || routingError() !== ''}")
  })

  it('未選択のアカウントへ勝手に保存せず、切替前の応答も表示しない', () => {
    expect(PAGE).toContain('const accountId = selectedAccountId')
    expect(PAGE).not.toContain('selectedAccountId ?? accounts[0]')
    expect(PAGE).toContain('loadedAccountId !== accountId')
    expect(PAGE).toContain('activeAccountRef.current !== accountId')
  })

  it('読み込みと保存の通信失敗から再操作できる', () => {
    expect(PAGE).toContain('もう一度読み込む')
    expect(PAGE).toContain('保存できませんでした。通信を確認して、もう一度お試しください。')
    expect(PAGE).toContain('finally')
    expect(PAGE).toContain('setSaving(false)')
  })
})

describe('V6 友だち追加時配信の、運用者の言葉', () => {
  it('画面にDBのカラム名を出さない', () => {
    expect(PAGE).not.toContain('friends.unfollow_count を見る')
    expect(PAGE).not.toContain('friends.first_followed_at を見る')
    expect(PAGE).toContain('これまでにブロックされた回数を見る')
    expect(PAGE).toContain('初回フォロー日の記録があるかを見る')
  })

  it('画面に内部のマイグレーション番号を出さない', () => {
    expect(PAGE).not.toMatch(/マイグレーション\s*\d+/)
    expect(PAGE).toContain('過去に追加された友だちにも')
  })

  it('①と②のどちらが効くかを本文で断る', () => {
    expect(PAGE).toContain('1人の友だちは①と②のどちらか一方にだけ振り分けられ、両方が動くことはありません')
    expect(PAGE).toContain('②で「はじめての人と同じもの」を選んだときだけ')
  })

  it('読込中と読込失敗の言い回しを画面共通にそろえる', () => {
    expect(PAGE).toContain('読み込んでいます')
    expect(PAGE).toContain('実績を読み込めませんでした')
    expect(PAGE).not.toContain('実績を取得できませんでした')
  })
})
