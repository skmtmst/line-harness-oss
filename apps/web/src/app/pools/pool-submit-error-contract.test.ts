import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

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

describe('新規プール窓の送信 (#1058)', () => {
  it('APIが例外を投げても「作成中…」のまま固まらない', () => {
    const body = fnBody(PAGE, 'const onSubmit = async ()')
    expect(body, '送信をtryで囲んでいない').toMatch(/try\s*\{[\s\S]*await api\.pools\.create/)
    expect(body, 'APIの例外を受けていない').toContain('} catch (err) {')
    expect(body, '失敗の理由を窓に出していない').toContain('setError(describeSaveFailure(err))')
    expect(body, '処理中の印を必ず戻していない').toMatch(/finally\s*\{[\s\S]*setSubmitting\(false\)/)
  })

  it('400系の理由はAPIの言葉、403・5xxは運用の言葉で出す（WRITE-01）', () => {
    expect(PAGE).toContain("import { api, ApiError, describeSaveFailure } from '@/lib/api'")
    const body = fnBody(PAGE, 'const onSubmit = async ()')
    expect(body, '生の例外文をそのまま出している')
      .not.toMatch(/setError\(\s*(err\.message|String\(err\)|err\s*\))/s)
  })

  it('APIの返事(success:false)と画面の失敗表示を従来どおり分ける', () => {
    const body = fnBody(PAGE, 'const onSubmit = async ()')
    expect(body).toContain('if (res.success) onCreated()')
    expect(body).toContain("else setError(res.error ?? '作成に失敗しました')")
  })
})

describe('プール所属アカウントの読み込み・追加 (#1058)', () => {
  it('useEffect はPromiseを返さない（Reactのcleanup契約）', () => {
    expect(PAGE, 'async関数をそのまま呼ぶとPromiseがcleanup扱いされ、拒否も拾えない')
      .toMatch(/useEffect\(\(\) => \{\s*void reload\(\)/)
    expect(PAGE).not.toMatch(/useEffect\(\(\) => \{\s*reload\(\)/)
  })

  it('一覧の読み直しに失敗したら握りつぶさず、行の下へ出す', () => {
    const body = fnBody(PAGE, 'const reload = async ()')
    expect(body, '読み直しをtryで囲んでいない').toMatch(/try\s*\{[\s\S]*await api\.pools\.accounts\.list/)
    expect(body, '失敗を受けていない').toContain('} catch {')
    expect(body, '失敗を画面に出していない').toContain('setListError(')
    expect(PAGE).toContain('{listError && (')
    // 取れなかったのに「所属アカウントなし」と見せない
    expect(PAGE).toContain('members.length === 0 && !listError')
  })

  it('追加に失敗したら静かに無視せず、理由を画面へ出す', () => {
    const body = fnBody(PAGE, 'const onAdd = async (lineAccountId: string)')
    expect(body, '返事を確かめていない').toContain('if (!res.success) throw new Error(res.error)')
    expect(body, '失敗を受けていない').toContain('} catch {')
    expect(body, '失敗を画面に出していない').toContain('setListError(')
    expect(body, '生のAPIエラーをそのまま出している')
      .not.toMatch(/setListError\(\s*(res\.error|String\(|e\b)/)
  })

  it('選択からの呼び出しもPromiseを宙に浮かせない', () => {
    expect(PAGE).toContain('void onAdd(e.target.value)')
  })
})
