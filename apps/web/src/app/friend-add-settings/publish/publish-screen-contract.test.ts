// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Steps } from '@/components/templates/steps'

afterEach(() => cleanup())

const DONE = readFileSync(join(__dirname, '../../../v8/friend-add-publish/done.tsx'), 'utf8')
const LIST = readFileSync(join(__dirname, '../../../v8/friend-add/list.tsx'), 'utf8')
const PAGE = readFileSync(join(__dirname, '../../../v8/friend-add-publish/publish.tsx'), 'utf8')

/** 友だち追加時配信の公開（設計 `ec9vg` 5-F ／ `quhg6` 5-G）。 */
describe('友だち追加時配信の公開画面', () => {
  it('読込・空・失敗・権限不足を別の面にする', () => {
    // V8 も開き先と通信・権限の失敗を分ける。
    for (const kind of ['unspecified', 'not-found', 'error']) {
      expect(PAGE).toContain(`kind="${kind}"`)
    }
    expect(PAGE).toContain('kind="forbidden"')
    // 404は「下書きがない」。失敗と混ぜない。
    expect(PAGE).toContain('caught.status === 404')
    expect(PAGE).toContain('caught.status === 403')
  })

  it('公開に版ごとの鍵を付ける', () => {
    // 二重に押しても2回公開されないよう、同じ下書きには同じ鍵を使う。
    expect(PAGE).toContain('idempotencyKeyFor({ accountId: at.accountId, versionId: rule.versionId ?? rule.id })')
  })

  it('押せないときに理由を出す', () => {
    expect(PAGE).toContain('blockedReason(validation)')
    expect(PAGE).toContain('disabled={!ready}')
  })

  it('過去28日の実績を未来の対象人数として表示しない', () => {
    // 公開後の返事を先取りしたり、設計の数字を置いたりしない。
    // 過去28日の実績を未来の対象人数として見せない。
    expect(PAGE).not.toContain('audienceText(')
    expect(PAGE).not.toContain('validation.estimatedAudienceCount')
  })

  it('確認は鍵で突き合わせ、説明文はサーバ値をそのまま出す', () => {
    // 順番 (配列の位置) で割り振ると、行が欠ける・意味がずれる。
    expect(PAGE).not.toContain('keys[index]')
    expect(PAGE).toContain('check.detail || check.label')
  })

  it('idが無いときは固定値で開かず、空の面にする', () => {
    // fixture の ID が無い環境で404・空画面になる。
    expect(PAGE).not.toContain("?? 'rule-referral'")
    expect(PAGE).toContain('if (!ruleId)')
  })

  it('公開後に実行結果へ進め、通知の接続状態を区別する', () => {
    expect(DONE).toContain('href="/friend-add-settings/runs"')
    expect(DONE).toContain("slackConnected === true")
    expect(DONE).toContain("slackConnected === false")
    expect(PAGE).toContain('slackConnected: slackOf(detail)')
  })

  it('画面を開くだけで試験を走らせない', () => {
    /*
     * dry-runの返事は `stateChanged: false` だが、**Worker側は
     * `last_test_status` と `last_tested_at` をDBへ記録する**。
     * 読み込みで呼ぶと、意図して試験していない下書きでも公開条件
     * （試験が成功していること）を満たしてしまう。
     * 固定の友だちIDを当てるのも同じ理由で危ない。
     */
    expect(PAGE).not.toContain('testDraft')
    expect(PAGE).not.toContain('friend-kyohei')
    // 最後の試験は、下書きが持っている記録から読む。
    expect(PAGE).toContain('rule.lastTestStatus')
    expect(PAGE).toContain('rule.lastTestedAt')
  })

  it('アカウントを変えたら前の結果を捨てる', () => {
    /*
     * 消さないと、切替先の取得に失敗したときに前のアカウントの
     * 下書き・確認・公開の結果が残り、別のアカウントの数を見ながら
     * 公開することになる。
     */
    for (const reset of ['setDetail(null)', 'setValidation(null)', 'setPublished(null)', "setError('')"]) {
      expect(PAGE).toContain(reset)
    }
  })

  it('最終確認は5段目を現在地にする', { timeout: 30000 }, () => {
    // 新しい Stepper は数値の current ではなく、段ごとの state の並びで表す。
    expect(PAGE).toContain('<Steps')
    expect(PAGE).toContain("state: index < PUBLISH_STEPS.length - 1 ? 'done'")
    expect(PAGE).toContain(": 'current'")
    expect(PAGE).not.toContain('current={')
    // 画面と同じ並びを描画して、5段目だけが現在地なのを確かめる。
    const steps = ['基本設定', '流入条件', '初回案内', 'アクション', '確認'].map((label, index) => ({
      label,
      state: (index + 1 < 5 ? 'done' : 'current') as const,
    }))
    render(React.createElement(Steps, { label: '設定の進み', steps }))
    const nav = screen.getByRole('navigation', { name: '設定の進み' })
    const items = nav.querySelectorAll('li')
    expect(items).toHaveLength(5)
    const current = nav.querySelector('[aria-current="step"]')
    expect(current?.textContent).toContain('確認')
    expect(nav.querySelectorAll('[data-step-state="done"]')).toHaveLength(4)
  })

  it('設計の最終確認に必要な時刻・プレビュー・監視状態を表示する', () => {
    // B-6: 題「LINEプレビュー」は共通部品が出す。画面側は使うだけ。
    expect(PAGE).toContain('<LinePreview')
    expect(PAGE).toContain('detail?.staffNotification?.status')
    expect(PAGE).toContain("status === 'connected'")
    expect(PAGE).toContain('def.messageText')
  })

  it('運用者向けの画面に内部の仕組みの名前を出さない', () => {
    expect(PAGE).not.toContain('value="webhookの記録で防ぎます"')
    expect(PAGE).not.toContain('value="有効（webhookの記録で判定）"')
  })

  it('有効化後は実行結果へ進み、停止・編集は一覧で行える', () => {
    expect(DONE).toContain('実行結果を見る')
    expect(DONE).toContain('一覧へ戻る')
    expect(DONE).toContain('一覧の「…」から止められます')
    for (const label of ['止める', '編集する']) expect(LIST).toContain(label)
    expect(LIST).toContain('api.friendAddRules.stop(')
    for (const label of ['未送信', '二重送信', 'シナリオ開始失敗']) expect(PAGE).toContain(label)
  })

  it.todo('ルールAPIに複製の口ができたら、別の経路用の複製を検証する')

  it('公開中にアカウントを変えられたら、返事を映さない', () => {
    /*
     * 公開はWorker側で進むが、その結果を**別のアカウントを見ている画面へ
     * 出すと、切替先で公開したように読める**。押した時点のアカウントと
     * 読み込み回数を控え、戻ってきたときに一致するかを見る。
     */
    expect(PAGE).toContain('const stillHere = ()')
    expect(PAGE).toContain('if (!stillHere()) return')
    expect(PAGE).toContain('if (stillHere()) setBusy(false)')
  })

  it('同じアカウントで読み直したときも取り違えない', () => {
    /*
     * アカウントIDだけでは、同じアカウントで読み直したときの
     * 取り違えを止められない。読み込み回数も一緒に見る。
     */
    expect(PAGE).toContain('generation')
    expect(PAGE).toContain('requestRef.current.generation === generation')
  })
})
