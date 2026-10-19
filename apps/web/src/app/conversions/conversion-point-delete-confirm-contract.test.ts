import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(path.join(__dirname, 'page.tsx'), 'utf8')
/* 止める窓は 管理画面 共用の `_components/conversion-dialogs.tsx` にある。 */
const DIALOGS = fs.readFileSync(path.join(__dirname, '../../v8/conversions', 'dialogs.tsx'), 'utf8')

/** 注意書きの中の `confirm(` に当てないため、コメントを外す。 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * **ファイル全体を `toContain` で見ない。**
 * 別の処理に同じ字があるだけで通ってしまう。本体とJSXだけを切り出す。
 */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from)
  expect(a, `${from} が見つからない`).toBeGreaterThanOrEqual(0)
  const b = src.indexOf(to, a + from.length)
  expect(b, `${to} が見つからない`).toBeGreaterThan(a)
  return src.slice(a, b)
}

const stopPane = () => slice(PAGE, 'const stopCard = stopTarget ?', 'let listBody: ReactNode')

describe('成果地点の削除確認', () => {
  it('ブラウザの confirm を使わない', () => {
    expect(code(PAGE), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(code(DIALOGS), 'ブラウザのconfirmへ戻っている').not.toMatch(/[^.\w]confirm\(/)
    expect(stopPane()).toContain('<Dialog open contentLayout="form"')
    // 窓の題と停止操作は conversion-points-v8.react.test.tsx で描画して確かめる。
  })

  it('停止の本体が二度押しを止め、3操作の返事を確かめ、finally で戻す', () => {
    const body = slice(PAGE, 'const runStop = async', 'const duplicatePoint = async')
    expect(body, '処理中でも受け付けてしまう').toContain('if (!stopTarget || stopping || !canEdit || stopImpactLoading) return')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body).toContain('api.conversions.stopDefinition')
    expect(body).toContain('api.conversions.replaceDefinition')
    expect(body).toContain('api.conversions.deleteDefinition')
    expect(body, '失敗を握りつぶしている').toContain('この成果地点の計測を止められませんでした。')
    expect(body, '生のAPIエラーをそのまま出している').not.toContain('setStopError(res.error)')
    expect(body, 'finally で処理中を戻していない').toMatch(/finally \{\s*setStopping\(false\)/)
  })

  it('V8の3択の欄で処理中を止め、失敗を欄内に出す', () => {
    const dialog = stopPane()
    expect(PAGE).toContain("action: ConversionStopAction = 'stop'")
    expect(dialog).toContain('busy={stopping || stopImpactLoading}')
    expect(dialog).toContain('stopError')
    for (const label of ['止める（使う所の計測も止まる）', '別の成果地点に差し替えてから止める', '削除する']) {
      expect(dialog).toContain(label)
    }
  })

  it('過去記録を残し、実データの利用先件数と3つの選択肢を本文で示す', () => {
    const dialog = stopPane()
    expect(dialog).toContain('過去の記録と分析は残します。')
    expect(dialog).toContain('formatNumber(stopImpact.stopImpact.affectedUsageCount)')
    expect(dialog).toContain('value="stop"')
    expect(dialog).toContain('value="replace"')
    expect(dialog).toContain('value="delete"')
    expect(dialog).toContain('stopImpact?.canDelete')
    expect(dialog).toContain('replacementCandidates')
  })

  it('窓を開く前に利用先・停止影響・削除可否を実APIから読む', () => {
    const body = slice(PAGE, 'const openStop = async', '\n  const runStop')
    expect(body).toContain('api.conversions.definitionDeleteImpact(target.id)')
    expect(body).toContain('setStopImpact(response.data)')
    expect(body).toContain('利用先と停止の影響を読み込めませんでした')
  })
})
