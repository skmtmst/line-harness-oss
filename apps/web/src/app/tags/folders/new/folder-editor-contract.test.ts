import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const FOLDER_EDITOR = 'app/tags/folders/new/page.tsx'

describe('フォルダの作成・編集（設計 byqIW）', () => {
  it('友だち属性の一覧に、追加・編集で同じモーダルを重ねる', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toContain("usePageTitle('友だち属性')")
    expect(source).not.toContain('<h1')
    expect(source).not.toContain('text-[32px]')
    expect(source).toContain('<TagsPageV4 accountId={selectedAccountId} />')
    expect(source).toContain('role="dialog"')
    expect(source).toContain("{editId ? 'フォルダを編集' : 'フォルダを追加'}")
    expect(source).toContain('useOverlayFocus(!deleteOpen, close, saving)')
    expect(source).toContain('max-w-[620px]')
    expect(source).toContain('名前と色を変えられます。削除しても中の項目は未分類に残ります。')
    expect(source).toContain('aria-label="閉じる"')
  })

  it('色見本は枠38×38の中に20×20の円で、枠ごと塗らない', () => {
    const source = read(FOLDER_EDITOR)
    // 設計 `byqIW`：枠 38x38 / r=10(`rounded-card`) / 背景 canvas。
    expect(source).toContain('rounded-card bg-canvas flex h-[38px] w-[38px]')
    // 中の円は 20x20（h-5 w-5）。以前は 36px の丸を色で塗りつぶしていた。
    expect(source).toContain('flex h-5 w-5 items-center justify-center rounded-pill')
    expect(source).not.toContain('h-9 w-9 rounded-pill')
    // 選択中は円の上に16pxのチェック。
    expect(source).toContain('<Check size={16}')
    expect(source).toContain("{ value: '#7C3AED', name: '紫' }")
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
    expect(source).toContain('h-2.5 w-2.5 shrink-0 rounded-pill')
    expect(source).toContain('style={{ backgroundColor: color }}')
    expect(source).toContain('text-label text-ink font-medium')
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

  it('削除の失敗は保存と別の言葉で出す', () => {
    const source = read(FOLDER_EDITOR)
    // D013: 以前は削除の失敗にも保存系の文言を使っていた。
    expect(source).toContain('folderDeleteErrorMessage(')
    expect(source).toMatch(/remove[\s\S]*?folderDeleteErrorMessage/u)
    expect(source).not.toMatch(/setDeleteOpen\(false\)[\s\S]{0,200}?folderSaveErrorMessage/u)
  })

  it('編集時はフォルダだけを削除し、中のタグを残すことを確認する', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toContain('api.tagGroups.delete(editId, folderAccountId)')
    expect(source).toContain('このフォルダを削除する')
    expect(source).toContain('中にあるタグは削除されず、未分類へ戻ります。')
    expect(source).toContain('フォルダを保存する')
  })

  it('選択中のLINE公式アカウントを分類の読込・保存へ渡す', () => {
    const source = read(FOLDER_EDITOR)
    expect(source).toContain('.list(selectedAccountId)')
    expect(source).toContain('accountId: selectedAccountId')
    expect(source).toContain('setFolderAccountId(group.accountId)')
  })
})

describe('友だち属性の一覧（設計 hqrOv）', () => {
  it('指標カード4枚を、取得失敗でも見出しごと残す', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // 「タグ数」は一覧の件数（1–20 / N件）と同じ数の重ね書きだったため
    // 「未使用」へ置き換えた（総数は一覧の上の1か所だけに出す決まり）。
    expect(source).toContain("titles={['未使用', '付与済み友だち', '今月の付与', '整理候補']}")
  })

  it('画面名を本文へ戻さない', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // `/tags` の画面名は共通トップバーが menu.ts から出す。
    expect(source).not.toContain("import Header from '@/components/layout/header'")
    expect(source).not.toContain('<h1')
  })

  it('ツールバーを枠付きカードで包まず、フォルダは240で置く', () => {
    const source = read('components/friend-fields/tags-page-v4.tsx')
    // Issue #456 で Pencil `XchZz` も更新。検索は余白を使い、選び口は
    // 共通 Select（素の select は置かない #640）。幅・高さは部品が持つ。
    // ★V7 `Xn1Mz`：道具の並びは共通 ListToolbar へそろえた。
    // 枠付きカードで包んだ直書きの帯に戻さない。
    expect(source).toContain('<ListToolbar')
    expect(source).not.toContain('type="search"')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('mb-[10px] flex flex-wrap items-center gap-2')
    expect(source).toContain('aria-label="使用状態で絞り込む"')
    expect(source).toContain('aria-label="付与元で絞り込む"')
    expect(source).toContain('aria-label="表示件数"')
    // 設計 `DgeL8` はフォルダ 240 固定。
    expect(source).toContain('xl:grid-cols-[240px_minmax(0,1fr)]')
  })
})
