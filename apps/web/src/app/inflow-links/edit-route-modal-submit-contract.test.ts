import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODAL = readFileSync(join(HERE, '_components', 'edit-route-modal.tsx'), 'utf8')

/** 名前で見つけた関数の本体だけを切り出す。ファイル全体を見ると素通しになる。 */
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl)
  if (start < 0) throw new Error(`${decl} が見つかりません`)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error(`${decl} の本体が閉じていません`)
}

describe('リファラルリンク編集窓の保存 (#1058)', () => {
  it('APIが例外を投げても「保存中…」のまま固まらない', () => {
    const body = fnBody(MODAL, 'const doSave = async ()')
    expect(body, '保存をtryで囲んでいない').toMatch(/try\s*\{[\s\S]*await api\.entryRoutes\./)
    expect(body, 'APIの例外を受けていない').toContain('} catch (err) {')
    expect(body, '失敗の理由を窓に出していない').toContain('setError(describeSaveFailure(err))')
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setSubmitting\(false\)/)
  })

  it('400系の理由はAPIの言葉、403・5xxは運用の言葉で出す（WRITE-01）', () => {
    expect(MODAL).toContain("import { api, describeSaveFailure } from '@/lib/api'")
    const body = fnBody(MODAL, 'const doSave = async ()')
    expect(body, '生の例外文をそのまま出している')
      .not.toMatch(/setError\(\s*(err\.message|String\(err\)|err\s*\))/s)
  })

  it('新規と更新、どちらの口でも失敗を拾う', () => {
    const body = fnBody(MODAL, 'const doSave = async ()')
    expect(body).toContain('api.entryRoutes.create(form)')
    expect(body).toContain('api.entryRoutes.update(route!.id, form)')
    expect(body).toContain('if (res.success) onSaved(res.data, isNew)')
    expect(body).toContain("else setError(res.error ?? '保存に失敗しました。通信を確かめて、もう一度お試しください。')")
  })

  it('失敗は窓の中に出る（★V7: 共通 Dialog のエラー表示へ）', () => {
    expect(MODAL).toContain("import Dialog from '@/components/shared/dialog'")
    expect(MODAL).toContain('error={error || undefined}')
  })
})
