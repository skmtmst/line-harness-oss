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
