import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** 注釈を落とす。**「なぜ h1 をやめたか」を書いた注釈が見張りに当たらないように。** */
const visible = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/**
 * 板 Y4LkX1 運用状態（健全性チェック）の表示確認。
 *
 * 板の骨組みが正本。見出し・補足・判定の見方の言葉は板どおりにし、
 * 数は口の実測だけを使う。
 */
describe('Y4LkX1 運用状態の表示確認', () => {
  it('板 Y4LkX1 の骨組みで作る', () => {
    expect(source).toContain("data-design-node={tab === 'health' ? 'Y4LkX1'")
    expect(source).toContain('<ReadonlyHeaderV8 title="運用状態"')
  })

  it('タブは板の並び（健全性チェック・更新履歴・緊急コントロール）', () => {
    const start = visible.indexOf('const TABS')
    const block = visible.slice(start, visible.indexOf(']', start) + 1)
    const keys = [...block.matchAll(/key: '(\w+)'/g)].map((match) => match[1])
    expect(keys).toEqual(['health', 'history', 'control'])
  })

  it('確定済み画面と同じ小さな文字階層を使い、h1 を重ねない', () => {
    expect(source).toContain('<PageHeader')
    expect(visible).not.toMatch(/<h1[\s>]/)
    expect(source).toContain('text-base font-bold text-ink">{`開いている異常')
    expect(source).toContain('text-base font-bold text-ink">何を止めますか')
    expect(source).toContain('text-base font-bold text-ink">復旧</h2>')
    expect(source).toContain('text-base font-bold text-ink">止めた・戻した記録')
  })

  it('タブごとの説明をPenと同じ内容で表示する', () => {
    expect(source).toContain('問題がないか自動で確認し、エラーがあれば内容と次の行動を表示します。')
    expect(source).toContain('止める配信を選び、理由を入力して緊急停止します。')
    expect(source).toContain('エラー、緊急停止、システム更新、設定変更を時間順に確認できます。')
    expect(source).toContain("description={tab === 'history' ? '' : description}")
  })

  it('サーバーが保存した9つのチェック項目を板の言葉と並びで常に表示する', () => {
    for (const title of [
      'LINE のアカウントとつながっているか',
      '5分ごとの確認が動いているか',
      'API・外部連携',
      '送れる数の上限',
      '友だちの急な減り',
      'Webhook が届いているか',
      '配信が送れているか',
      '裏の仕組み',
      '鍵・証明書の期限',
    ]) {
      expect(source).toContain(`title: '${title}'`)
    }
    const definitionsStart = visible.indexOf('const CHECK_DEFINITIONS')
    const definitions = visible.slice(definitionsStart, visible.indexOf('\n]', definitionsStart) + 2)
    const ids = [...definitions.matchAll(/id: '([a-z]+)'/g)].map((match) => match[1])
    expect(ids).toEqual(['line', 'monitoring', 'api', 'quota', 'friends', 'webhook', 'delivery', 'infra', 'credential'])
    expect(visible).toContain('const CHECK_COUNT = CHECK_DEFINITIONS.length')
    expect(visible).not.toMatch(/const CHECK_COUNT = \d+/)
    const mappingStart = visible.indexOf('const HEALTH_CHECK_ID')
    const mapping = visible.slice(mappingStart, visible.indexOf('\n}', mappingStart) + 2)
    const pairs = Object.fromEntries(
      [...mapping.matchAll(/(\w+): '([a-z]+)'/g)].map((match) => [match[1], match[2]]),
    )
    expect(pairs).toEqual({
      line_connection: 'line',
      message_quota: 'quota',
      external_integrations: 'api',
      webhook: 'webhook',
      dispatch_jobs: 'delivery',
      friend_change: 'friends',
      monitoring_heartbeat: 'monitoring',
      infra_canary: 'infra',
      credential_expiry: 'credential',
    })
  })

  it('件数と対応は定義の実体から決まる', () => {
    for (const template of ['全体の状態：', '開いている異常 ', '確かめていること', '判定の見方']) {
      expect(visible).toContain(template)
    }
  })

  it('全体の帯・下の3枚と上部の主要操作を表示する', () => {
    for (const label of ['止めた回数', 'いちばん長かった停止', 'いまの版']) {
      expect(source).toContain(`label="${label}"`)
    }
    expect(source).toContain('いますぐ確かめる')
    expect(source).toContain('api.operations.history')
  })

  it('古い確認を現在の正常と混ぜず、10分より古いものは「古い確認」にする', () => {
    expect(source).toContain('STALE_ITEM_AFTER_MS = 10 * 60 * 1000')
    expect(source).toContain("label: '古い確認'")
    expect(source).toContain('api.operations.health')
    expect(source).toContain('api.operations.runHealth')
    expect(source).toContain("observedAt: result?.observedAt ?? snapshot.lastCheckedAt")
    expect(source).not.toContain('api.health.getHealth')
  })

  it('5分ごとに実データを再確認する', () => {
    expect(source).toContain('window.setInterval')
    expect(source).toContain('5 * 60 * 1000')
  })

  it('緊急停止と履歴をサーバー共通のAPIへ保存する', () => {
    expect(source).toContain('api.operations.stop')
    expect(source).toContain('api.operations.restore')
    expect(source).toContain('api.operations.history')
    expect(source).toContain('api.operations.stepUp')
    expect(source).toContain('認証アプリの6桁コード')
    expect(source).toContain("item.historyKind === 'deployment'")
    expect(source).toContain("'auto_reply_dispatch'")
    expect(source).not.toContain('nen_emergency_snapshot_v1')
    expect(source).not.toContain('NEXT_PUBLIC_ADMIN_API_KEY')
  })
})
