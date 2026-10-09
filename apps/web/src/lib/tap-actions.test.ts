import { describe, expect, test } from 'vitest'
import { TAP_ACTION_DEFS, tapActionFromSavedUri, tapActionFromUri, tapActionLiffUrl, tapActionProblem, tapActionToUri } from './tap-actions'

describe('押したらの決まり（YPzmo）', () => {
  test('選べるのは絵の順の6つ', () => {
    expect(TAP_ACTION_DEFS.map((def) => def.label)).toEqual(['URLを開く', 'テキストを送る', '予約', '回答フォーム', '予約履歴', '来店スタンプ'])
    expect(TAP_ACTION_DEFS.filter((def) => def.needsLiff).map((def) => def.kind)).toEqual(['booking', 'form', 'booking_history', 'visit_stamp'])
  })

  test('動き→LIFF の URL と、URL→動きが行って戻る', () => {
    const cases = [
      ['form', 'f1', 'https://liff.line.me/L-1/?page=form&id=f1'],
      ['booking', '', 'https://liff.line.me/L-1/?page=salon-book'],
      ['booking', 'm1', 'https://liff.line.me/L-1/?page=salon-book&menu=m1'],
      ['booking_history', '', 'https://liff.line.me/L-1/?page=salon-book&view=history'],
      ['visit_stamp', '', 'https://liff.line.me/L-1/?page=visit-stamps'],
      ['visit_stamp', 'c 1', 'https://liff.line.me/L-1/?page=visit-stamps&card=c%201'],
    ] as const
    for (const [kind, refId, url] of cases) {
      expect(tapActionLiffUrl('L-1', kind, refId)).toBe(url)
      expect(tapActionFromUri(url)).toEqual({ kind, refId })
    }
    expect(tapActionFromUri('https://example.com/?page=form&id=1')).toEqual({ kind: 'uri', refId: '' })
  })

  test('URL だけを保存する所：LIFF が無ければ作らず、外の URL はそのまま戻す', () => {
    expect(tapActionToUri({ kind: 'booking', uri: '', text: '', refId: '' }, null)).toBeNull()
    expect(tapActionToUri({ kind: 'uri', uri: ' https://a.example ', text: '', refId: '' }, null)).toBe('https://a.example')
    expect(tapActionFromSavedUri('https://a.example')).toEqual({ kind: 'uri', uri: 'https://a.example', text: '', refId: '' })
    expect(tapActionFromSavedUri('https://liff.line.me/L/?page=visit-stamps&card=c9')).toEqual({ kind: 'visit_stamp', uri: '', text: '', refId: 'c9' })
  })

  test('保存の前に止める', () => {
    const where = 'ボタン1'
    expect(tapActionProblem({ kind: 'form', uri: '', text: '', refId: '' }, { where, hasLiff: true })).toBe('ボタン1の回答フォームを選んでください')
    expect(tapActionProblem({ kind: 'booking', uri: '', text: '', refId: '' }, { where, hasLiff: true })).toBeNull()
    expect(tapActionProblem({ kind: 'booking', uri: '', text: '', refId: '' }, { where, hasLiff: false })).toContain('LIFF')
    expect(tapActionProblem({ kind: 'message', uri: '', text: 'あいう', refId: '' }, { where, hasLiff: true, textMax: 2 })).toBe('ボタン1の送る文は2文字までです')
    expect(tapActionProblem({ kind: 'template', uri: '', text: '', refId: '' }, { where, hasLiff: false })).toBeNull()
  })
})
