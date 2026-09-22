import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readFileSync(join(HERE, 'broadcast-form.tsx'), 'utf8')
const CONFIRM = readFileSync(join(HERE, '..', 'shared', 'confirm-dialog.tsx'), 'utf8')

/**
 * 一斉配信の最終確認（設計 `FpgxH` 6-1-H）。
 *
 * ここまでは「配信を予約する」が `save()` を直に呼び、**押した瞬間に
 * 1,000人以上へ予約が入っていました。** 何人に・いつ・何を送るのかを
 * 読み合わせる場所がありませんでした。
 */
describe('一斉配信の最終確認', () => {
  it('予約は確認を通す。下書き保存は通さない', () => {
    expect(FORM).toContain("sendMode === 'scheduled' ? openConfirm() : void save()")
  })

  it('確認の窓は共通部品を使う', () => {
    expect(FORM).toContain("import ConfirmDialog from '@/components/shared/confirm-dialog'")
    expect(FORM).toContain('data-design-node="FpgxH"')
  })

  it('入り口で止める。窓の中で初めて弾かない', () => {
    expect(FORM).toContain('const validationError = validate()\n    if (validationError) { setError(validationError); return }')
  })

  /**
   * **人数を固定値で作らない。** `preflight` が数えたぶんだけを使う。
   * 「たぶんこのくらい」を書くと、その数を根拠に押される。
   */
  it('対象人数は配信前チェックの結果だけから取る', () => {
    expect(FORM).toContain('const audienceCount = preflight?.audienceCount ?? null')
  })

  it('事前確認が数え終えた人数を対象画面の要約にも使う', () => {
    expect(FORM).toContain('const audienceDisplayCount = audienceCount')
    expect(FORM).not.toContain('api.segments.count(')
    expect(FORM).toContain("audienceDisplayCount?.toLocaleString('ja-JP') ?? '—'")
    expect(FORM).toContain("audienceDisplayCount === null ? '—' : `${audienceDisplayCount.toLocaleString('ja-JP')}人`")
  })

  it('数えられていないときは送らせない', () => {
    expect(FORM).toContain('const canConfirm = audienceCount !== null && audienceCount > 0')
    // `onConfirm` を渡さないと、確認のボタンごと出ない（`Dialog` の作り）。
    expect(FORM).toContain('onConfirm={canConfirm ? () => void save() : undefined}')
  })

  it('未取得は「—」。0人と書かない', () => {
    expect(FORM).toContain("{audienceCount === null ? '—' : `${audienceCount.toLocaleString('ja-JP')}人`}")
    // 除外人数は数としての口が無いので、無いときは `—`。
    expect(FORM).toContain('除外した人数はまだ取れません')
  })

  it('確認に並べるのは、条件・人数・除外・日時・中身', () => {
    for (const label of ['配信対象', '除外', '配信日時', '送る中身']) {
      expect(FORM).toContain(`>${label}</dt>`)
    }
  })

  it('確認の窓に中身を置ける', () => {
    expect(CONFIRM).toContain('children?: ReactNode')
    expect(CONFIRM).toContain('{children}')
  })

  it('送っているあいだは押せない', () => {
    expect(FORM).toContain('busy={saving}')
  })
})

/**
 * IDEA-06（Issue #1024）：既存の最終確認に、対象数・除外理由・計算時刻・
 * 送信枠・把握できる重複配信をまとめる。画面内の「最終確認」節と、
 * 予約の確認窓の両方が対象。
 */
describe('最終確認へのまとめ（IDEA-06）', () => {
  // 画面内の「最終確認」節だけを切り出す。
  const SECTION = FORM.slice(
    FORM.indexOf('>最終確認</h3>'),
    FORM.indexOf("shows('message') && lengthNotice.tone === 'error'"),
  )
  // 予約の確認窓（ConfirmDialog の中身）だけを切り出す。
  const DIALOG = FORM.slice(
    FORM.indexOf('open={confirmOpen}'),
    FORM.indexOf('open={testDialogOpen}'),
  )

  it('画面内の確認に、対象数・除外理由・送信枠・計算時刻を並べる', () => {
    for (const label of ["'対象'", "'除外'", "'配信日時'", "'送信枠'", "'計算時刻'"]) {
      expect(SECTION, `${label} がありません`).toContain(label)
    }
  })

  it('確認の窓にも送信枠と計算時刻を出す', () => {
    expect(DIALOG).toContain('>送信枠</dt>')
    expect(DIALOG).toContain('>計算時刻</dt>')
  })

  it('計算時刻は配信前チェックが数えた時刻だけを使う', () => {
    // 表示側で今の時刻を作ると「いつ数えた数か」が誤魔化せる。
    expect(FORM).toContain('preflight?.audience?.evaluatedAt')
    expect(FORM).toContain('timeZone: \'Asia/Tokyo\'')
  })

  it('送信枠は取得失敗・不足・残りを分け、0や空白で誤魔化さない', () => {
    expect(FORM).toContain("quota.state === 'unavailable'")
    expect(FORM).toContain("quota.state === 'insufficient'")
    expect(FORM).toContain('確認できませんでした')
    expect(FORM).toContain('この配信で ${quota.planned.toLocaleString')
  })

  it('把握できる重複配信を、両方の確認へ出す', () => {
    expect(SECTION).toContain('concurrentBroadcasts.map')
    expect(SECTION).toContain('同じ時刻の前後1時間に別の予約配信があります')
    expect(DIALOG).toContain('concurrentBroadcasts.map')
    expect(DIALOG).toContain('同じ時刻の前後1時間に別の予約配信があります')
  })

  it('条件が変わると、古い確認を解除する', () => {
    // 応答には取ったときの入力の指紋を付け、今の入力とずれたら使わない。
    expect(FORM).toContain('const currentPreflightKey = JSON.stringify(preflightRequestBody())')
    expect(FORM).toContain('preflightKey === currentPreflightKey')
    // 宛先・本文が壊れている間は確認結果そのものを捨てる。
    expect(FORM).toContain('setPreflightResult(null)')
    expect(FORM).toContain('setPreflightKey(null)')
    // 遅れて届いた古い要求の応答で、新しい確認を上書きしない。
    expect(FORM).toContain('seq !== preflightSeq.current')
  })

  it('今すぐ配信・予約・下書きを混同しない', () => {
    // 段つき画面の確定ボタンは、予約のときだけ「予約」と言う。
    expect(FORM).toContain("sendMode === 'scheduled' ? 'この内容で予約' : '保存して送信画面へ'")
    // 「今すぐ」は日時を持たない。「未設定」とは書かず、次の操作場所を書く。
    expect(FORM).toContain("'今すぐ（保存後に詳細画面で送信）'")
    expect(FORM).toContain('今すぐ配信を選んでいます')
    // 保存した下書きは、送信ボタンのある詳細画面へ進める。
    const NEW_PAGE = readFileSync(join(HERE, '..', '..', 'app', 'broadcasts', 'new', 'page.tsx'), 'utf8')
    expect(NEW_PAGE).toContain('`/broadcasts?id=${encodeURIComponent(broadcast.id)}`')
  })
})
