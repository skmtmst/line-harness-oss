import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(process.cwd(), 'src/app/broadcasts/reserved/page.tsx'), 'utf8')
const FORM = readFileSync(join(process.cwd(), 'src/components/broadcasts/broadcast-form.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(process.cwd(), 'src/app/broadcasts/new/page.tsx'), 'utf8')

describe('V6 一斉配信の予約完了', () => {
  it('作成結果の実IDを完了画面へ渡す', () => {
    expect(FORM).toContain('const saved = await persistDraft(scheduledAtIso())')
    expect(FORM).toContain('onSuccess(saved)')
    expect(NEW_PAGE).toContain('/broadcasts/reserved?id=')
    expect(NEW_PAGE).toContain("broadcast.status === 'scheduled'")
  })

  it('テスト送信と最終予約は同じ下書きを更新する', () => {
    expect(FORM).toContain('const draft = await persistDraft(null)')
    expect(FORM).toContain('api.broadcasts.testSend(draft.id)')
    expect(FORM).not.toContain('idempotencyKey: crypto.randomUUID()')
  })

  it('保存した配信を読み直し予約状態を確かめる', () => {
    expect(PAGE).toContain('api.broadcasts.get(id)')
    expect(PAGE).toContain("broadcast.status !== 'scheduled'")
    expect(PAGE).toContain('!broadcast.scheduledAt')
  })

  it('予約人数を保存値や固定値で作らず現在の見込みとして表示する', () => {
    /*
      **保存した数を出さない。** 予約してから配信までに友だちが増減するので、
      いま数え直した見込みを出す。数の出し方は共通の `SummaryCard` に寄せた
      （画面ごとに `—` の書き方が変わらないように）。
    */
    expect(PAGE).toContain('api.broadcasts.preflight')
    expect(PAGE).toContain('value={estimate?.audienceCount ?? null}')
    expect(PAGE).toContain('送信を始める直前に同じ条件でもう一度数えます')
    expect(PAGE).not.toContain('totalCount')
  })

  it('未取得と実値0を分ける', () => {
    /*
      **人数だけ取れなくても、予約そのものは出す。** 数は `SummaryCard` が
      `—` にし、理由を副文で言う。0人（本当に誰にも届かない）とは別物。
    */
    expect(PAGE).toContain("detail={estimate ? 'いま同じ条件で数えた人数' : '現在の人数を確認できませんでした'}")
    expect(PAGE).toContain("detail={estimate ? 'ブロック・非表示などを除外' : '現在の除外人数を確認できませんでした'}")
  })

  it('選択中アカウントと所属先が違う配信を表示しない', () => {
    expect(PAGE).toContain('belongsToAccount(broadcast, selectedAccountId)')
    expect(PAGE).toContain('選択中のアカウントの配信ではありません')
  })

  it('遲れて返った別の予約の結果で画面を上書きしない', () => {
    expect(PAGE).toContain('const requestGeneration = useRef(0)')
    expect(PAGE).toContain('requestGeneration.current === generation')
    expect(PAGE).toContain('if (!isCurrent()) return')
    expect(PAGE).toContain('requestGeneration.current += 1')
    expect(PAGE).toContain('if (isCurrent()) setLoading(false)')
  })

  it('送信時に再集計することを明記する', () => {
    expect(PAGE).toContain('送信を始める直前に同じ条件でもう一度数えます')
    expect(PAGE).toContain('現在の見込み')
  })

  it('予約した内容を実値で読み合わせる', () => {
    /* 設計 `bPF0s` の面。**固定値を混ぜず、予約したものそのものを出す。** */
    expect(PAGE).toContain('data-design-node="bPF0s"')
    expect(PAGE).toContain('予約した内容')
    expect(PAGE).toContain('{formatJst(broadcast.scheduledAt)}')
  })

  it('予約取消は確認後に専用の競合防止APIへ渡す', () => {
    /*
      題は**配信の名前**を出す（削除の窓 `EGMb1` と同じ形）。2枚開いて
      いるときに、どちらを取り消すのか読めなくなるため。
    */
    expect(PAGE).toContain('の予約を取り消しますか？`}')
    expect(PAGE).toContain('書いた内容は下書きとして残るので、作り直しにはなりません。')
    /* **取り消せるのは、まだ送り始めていない予約だけ。** */
    expect(PAGE).toContain("{broadcast.status === 'scheduled' && !cancelled && (")
    /* 口の返事をそのまま出さない。409 も通信の失敗も、やることは同じ。 */
    expect(PAGE).not.toMatch(/setCancelError\(\s*(res\.error|String\()/)
    expect(PAGE).toContain('api.broadcasts.cancelReservation(broadcast.id)')
    expect(PAGE).not.toContain('api.broadcasts.delete(broadcast.id)')
  })
})
