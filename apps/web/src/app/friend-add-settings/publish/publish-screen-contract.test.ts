import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

/** 友だち追加時配信の公開（設計 `ec9vg` 5-F ／ `quhg6` 5-G）。 */
describe('友だち追加時配信の公開画面', () => {
  it('読込・空・失敗・権限不足を別の面にする', () => {
    for (const kind of ['loading', 'empty', 'error', 'forbidden']) {
      expect(PAGE).toContain(`kind="${kind}"`)
    }
    // 404は「下書きがない」。失敗と混ぜない。
    expect(PAGE).toContain('error.status === 404')
    expect(PAGE).toContain('error.status === 403')
    expect(PAGE).toContain('確認する下書きがありません')
  })

  it('設計のNodeと押し口に印を付ける', () => {
    expect(PAGE).toContain('data-design-node="ec9vg"')
    expect(PAGE).toContain('data-design-node="quhg6"')
    expect(PAGE).toContain('data-qa-open="ec9vg"')
    expect(PAGE).toContain('data-qa-open="quhg6"')
  })

  it('公開に版ごとの鍵を付ける', () => {
    // 二重に押しても2回公開されないよう、同じ下書きには同じ鍵を使う。
    expect(PAGE).toContain('idempotencyKeyFor(draft)')
  })

  it('押せないときに理由を出す', () => {
    expect(PAGE).toContain('blockedReason(validation)')
    expect(PAGE).toContain('disabled={!ready}')
  })

  it('公開前の対象見込みは validation の値を使う', () => {
    // 公開後の返事を先取りしたり、設計の数字を置いたりしない。
    expect(PAGE).toContain('audienceText(validation?.estimatedAudienceCount)')
    expect(PAGE).not.toContain('214人')
  })

  it('実行結果へは、つながっているときだけリンクする', () => {
    expect(PAGE).toContain('monitoring.href ?')
    expect(PAGE).toContain('monitoringLink(result)')
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
    expect(PAGE).toContain('draft.lastTestStatus')
    expect(PAGE).toContain('draft.lastTestedAt')
  })

  it('アカウントを変えたら前の結果を捨てる', () => {
    /*
     * 消さないと、切替先の取得に失敗したときに前のアカウントの
     * 下書き・確認・公開の結果が残り、別のアカウントの数を見ながら
     * 公開することになる。
     */
    for (const reset of ['setDraft(null)', 'setValidation(null)', 'setPublished(null)', "setPublishError('')"]) {
      expect(PAGE).toContain(reset)
    }
  })

  it('最終確認は5段目を現在地にする', () => {
    expect(PAGE).toContain('current={5}')
    expect(PAGE).toContain('complete')
    expect(PAGE).not.toContain('current={4}')
  })

  it('設計の最終確認に必要な時刻・プレビュー・監視状態を表示する', () => {
    expect(PAGE).toContain('登録直後から5分以内')
    expect(PAGE).toContain('LINEプレビュー')
    expect(PAGE).toContain('Slack通知（未接続）')
    expect(PAGE).toContain('初回案内の本文は、選択したシナリオで確認してください。')
  })

  it('運用者向けの画面に内部の仕組みの名前を出さない', () => {
    expect(PAGE).not.toContain('value="webhookの記録で防ぎます"')
    expect(PAGE).not.toContain('value="有効（webhookの記録で判定）"')
    expect(PAGE).toContain('同じ友だち追加通知は1回だけ処理します。')
  })

  it('有効化後に次の操作と監視対象を説明する', () => {
    for (const label of [
      '配信を一時停止',
      '内容を編集する',
      'テストを再送信',
      '別の経路用に複製',
      '未送信',
      '二重送信',
      '再追加の連続実行',
      'シナリオ開始失敗',
    ]) {
      expect(PAGE).toContain(label)
    }
    expect(PAGE).toContain('Slack通知はまだ接続されていません')
  })

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
