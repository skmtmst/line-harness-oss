import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const FOLDER_EDITOR = 'app/tags/folders/new/page.tsx'

describe('フォルダの作成・編集（設計 byqIW）', () => {
  it('画面名を共通トップバーだけに置き、本文の大見出しへ戻さない', () => {
    const source = read(FOLDER_EDITOR)
    // 上部バーと同じ文字が本文にもう一度出ていた（`<h1 class="text-[32px]">`）。
    expect(source).toContain("usePageTitle(editId ? 'フォルダを編集' : 'フォルダを追加')")
    expect(source).not.toContain('<h1')
    // 32px はトークン外（`--text-display` は 30px）。値を直接書かない。
    expect(source).not.toContain('text-[32px]')
  })

  it('色見本は枠38×38の中に20×20の円で、枠ごと塗らない', () => {
    const source = read(FOLDER_EDITOR)
    // 設計 `byqIW`：枠 38x38 / r=10(`rounded-card`) / 背景 canvas。
    expect(source).toContain('rounded-card bg-canvas flex h-[38px] w-[38px]')
    // 中の円は 20x20（h-5 w-5）。以前は 36px の丸を色で塗りつぶしていた。
    expect(source).toContain('flex h-5 w-5 items-center justify-center rounded-full')
    expect(source).not.toContain('h-9 w-9 rounded-full')
    // 選択中は円の上に16pxのチェック。
    expect(source).toContain('<Check size={16}')
  })

  it('「一覧での表示」の見本が、選んだ色と入力中の名前で出る', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toContain('一覧での表示')
    // 設計 r=10 / pad14 / gap7、見出しは nano 10/600。
    expect(source).toContain('rounded-card')
    expect(source).toContain('gap-[7px]')
    expect(source).toContain('p-[14px]')
    expect(source).toContain('text-nano')
    // 10x10 の円は**選んだ色**、名前は label13/700。
    expect(source).toContain('h-2.5 w-2.5 shrink-0 rounded-full')
    expect(source).toContain('style={{ backgroundColor: color }}')
    expect(source).toContain('text-label text-ink font-bold')
  })

  it('フォルダ名の入力欄は h=44・文字13', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toMatch(/text-label[^"]*h-11 w-full/u)
    // 以前は py-2.5（=42px）・text-sm（14px）だった。
    expect(source).not.toContain('w-full rounded-control border border-hairline px-3 py-2.5 text-sm')
  })

  it('読込中・失敗・権限不足を言い分け、失敗を空欄のまま保存させない', () => {
    const source = read(FOLDER_EDITOR)
    // 以前は `if (!result.success) return` で失敗を黙って捨てていた。
    // 空欄のまま保存すると、元の名前を消すことになる。
    expect(source).not.toContain('if (!result.success) return')
    expect(source).toContain("setLoadState('error')")
    expect(source).toContain('読み込んでいます')
    expect(source).toContain('読み込めませんでした')
    expect(source).toContain('再読み込み')
    expect(source).toContain('見る権限がありません')
    expect(source).toContain('操作する権限がありません')
    // 保存は読み込めているときだけ通す。
    expect(source).toContain("if (!name.trim() || saving || loadState !== 'ready') return")
    expect(source).toContain('isCurrentFolderRequest(activeRequestRef.current, request)')
    expect(source).toContain("setName('')")
  })

  it('保存上限をWorkerと揃え、APIの生文を画面へ出さない', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toContain('maxLength={60}')
    expect(source).toContain('folderSaveErrorMessage(')
    expect(source).not.toContain('throw new Error(result.error)')
  })

  it('保存が押せないときは、理由を本文に出す', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toContain('const blockedReason =')
    expect(source).toContain('disabled={saving || blockedReason !== null}')
    // 押せない見た目だけにしない。
    expect(source).toContain("{loadState === 'ready' && blockedReason && (")
  })
})

describe('友だち属性の一覧（設計 hqrOv）', () => {
  it('指標カード4枚を、取得失敗でも見出しごと残す', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    expect(source).toContain("titles={['タグ数', '付与済み友だち', '今月の付与', '整理候補']}")
  })

  it('画面名を本文へ戻さない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // `/tags` の画面名は共通トップバーが menu.ts から出す。
    expect(source).not.toContain("import Header from '@/components/layout/header'")
    expect(source).not.toContain('<h1')
  })

  it('ツールバーを枠付きカードで包まず、フォルダは240で置く', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 設計 `XchZz` に枠は無い。中の3つは h=36(h-9)・r=8(`rounded-control`)・13。
    expect(source).toContain('mb-[10px] flex flex-wrap items-center gap-2')
    expect(source).toMatch(/h-9 w-\[144px\] rounded-control/u)
    expect(source).toMatch(/h-9 w-\[129px\] rounded-control/u)
    expect(source).toMatch(/h-9 w-\[116px\] rounded-control/u)
    // 設計 `DgeL8` はフォルダ 240 固定。
    expect(source).toContain('xl:grid-cols-[240px_minmax(0,1fr)]')
  })
})
