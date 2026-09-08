import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 URqOA 定期レポート作成', () => {
  it('設計の入力・予告・関係先を持つ', () => {
    for (const text of [
      '何を入れますか', 'いつ送りますか', 'だれに送りますか', '知らせの決めごと',
      '宛先を足す', 'LINEでも同じ内容を送る', 'いますぐ1回だけ送ってみる', 'つくって動かす',
      'レポートが見ているもの', 'つながる先', '気をつけること',
    ]) expect(PAGE).toContain(text)
    expect(PAGE).toContain('data-design-node="URqOA"')
  })

  it('通常・読込・空・失敗と権限を画面で分ける', () => {
    expect(PAGE).toContain('定期レポートを読み込んでいます')
    expect(PAGE).toContain('受け取るログインユーザーがいません')
    expect(PAGE).toContain('定期レポートの設定を読み込めませんでした')
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('<ListState kind="error"')
    expect(PAGE).toContain('kind="empty"')
    expect(PAGE).toContain("response.data.role === 'owner' || response.data.role === 'admin'")
    expect(PAGE).toContain('disabled={saving || !canManage || !hasRecipient}')
  })

  it('本物の設定APIへ接続し、未取得を0へ置き換えない', () => {
    expect(API).toContain('/api/analytics/report-schedules?account_id=')
    expect(PAGE).toContain('api.analytics.reportSchedules.list')
    expect(PAGE).toContain('api.analytics.reportSchedules.create')
    expect(PAGE).not.toContain("|| 0")
  })

  it('名前を変えられ、保存した分析を添えられる(点検#508軽12)', () => {
    // 固定名だと複数作ったときに区別できない。空のままは作れない。
    expect(PAGE).toContain("useState('週次まとめ')")
    expect(PAGE).toContain('レポートの名前を入力してください')
    expect(PAGE).toContain('保存した分析を添えます')
    expect(PAGE).toContain('options.savedAnalyses')
    expect(PAGE).toContain('savedAnalysisIds')
  })

  it('宛先の初期値は空で、0件のときは作れない(点検#508の中1)', () => {
    // 例のアドレスが最初から入っていると、選んでいない相手へ送られる。
    expect(PAGE).not.toContain("useState(['report@example.com'])")
    // 受信者の先頭2件の自動チェックもしない。
    expect(PAGE).not.toContain('slice(0, 2)')
    expect(PAGE).toContain('hasRecipient')
    expect(PAGE).toContain('受け取る人を1人以上選んでください')
  })
})
