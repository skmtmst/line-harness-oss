import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FORM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'broadcast-form.tsx'),
  'utf8',
)

/** 一斉配信の作成（設計 `zZ9fA` 6-1-A ／ `XQfMD` 6-1-C ／ `p97Tf` 6-1-D）。 */
describe('一斉配信の作成', () => {
  it('節の番号が画面に出てくる順になっている', () => {
    /*
     * 前は 1. 送る相手 → 3. 送る内容 → 2. 送る時間 と並んでいて、
     * 飛ばした節があるように読めた。
     */
    const numbers = [...FORM.matchAll(/([123])\. 送る(相手|内容|時間)/g)].map((m) => m[0])
    expect(numbers).toEqual(['1. 送る相手', '2. 送る内容', '3. 送る時間'])
  })

  it('本文の上限を直書きしない', () => {
    // 500 が3か所に散っていて、片方だけ直すと数え方がずれていた。
    expect(FORM).not.toMatch(/maxLength=\{500\}/)
    expect(FORM).not.toMatch(/\/ 500/)
    expect(FORM).toContain('MAX_TEXT_LENGTH')
    expect(FORM).toContain('MAX_BUBBLES')
  })

  it('送信対象の未取得を半角ハイフンで書かない', () => {
    expect(FORM).not.toMatch(/toLocaleString\('ja-JP'\) \?\? '-'/)
    expect(FORM).toContain("toLocaleString('ja-JP') ?? '—'")
  })

  it('上限を超えたまま保存・送信できない', () => {
    /*
     * 本文の欄は `maxLength` で止まるが、下書きやテンプレートから読み込むと
     * 上限を超えた本文が入ることがある。**そのとき保存だけが静かに 400 で
     * 失敗する**——押した人にはどの通のどこが長いのか分からない。
     */
    expect(FORM, '保存が止まらない').toContain("disabled={saving || lengthNotice.tone === 'error'}")
    expect(FORM, 'テスト送信が止まらない').toContain("disabled={testSending || saving || lengthNotice.tone === 'error'}")
  })

  it('上限超過を、押す前に本文の文字で出す', () => {
    /* 右の点検欄は宛先と本文が決まるまで出ないので、こちらは常に出す。 */
    expect(FORM).toContain("{lengthNotice.tone === 'error' && (")
    expect(FORM).toContain('<p className="text-danger text-sm font-bold">{lengthNotice.title}</p>')
    expect(FORM, '押せない理由が吹き出しに出ない').toContain(
      "title={lengthNotice.tone === 'error' ? lengthNotice.description : undefined}",
    )
  })

  it('知らない種類でも内部の語を出さない', () => {
    // `?? template.messageType` だと札に `text` や `carousel` が出る。
    expect(FORM).not.toContain('?? template.messageType')
    expect(FORM).toContain("?? 'その他'")
  })
})
