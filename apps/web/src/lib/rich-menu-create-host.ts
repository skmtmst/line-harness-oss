import type { ReactNode } from 'react'
import type { HqRichMenuSeed } from './hq-rich-menu-create'

/**
 * 店のリッチメニューの作る画面（app/rich-menus/new/create-v8.tsx）を、統括のひな形から使う口（B-36・絵 gobhu・egdGx・K0gu1・gQabc）。
 *
 * 店は手順①〜④のたびにサーバーへ下書きを保存するが、統括のひな形は一度に保存する形。
 * host を渡したときは、手順の間は画面の中に持ち（画像だけは統括の置き場へ先に上げる）、
 * 「下書きを保存」「アカウントへ配る」で一度だけ onSave に渡す。店の動き（host なし）は変えない。
 */
export interface RichMenuCreateHost {
  /** 戻る先（キャンセル・頭の「← リッチメニューへ」）。 */
  backHref: string
  onCancel: () => void
  /** owner・admin だけ保存・配るを押せる。 */
  canOperate: boolean
  folders: Array<{ id: string; name: string }>
  /** フォルダを選ぶ欄からその場で作る（dLffh）。呼ぶ側の種類のフォルダの口。色は受け取らない。 */
  createFolder?: (name: string) => Promise<{ id: string; name: string }>
  /** ボタンの動きで選べる参照（統括のタグ・テンプレート・回答フォームのひな形。配った先の同じ名前に直す）。 */
  references: { tags: Array<{ id: string; name: string }>; templates: Array<{ id: string; name: string }>; forms: Array<{ id: string; name: string }> }
  /** 直すときに保存してある中身。新しく作るときは無い。 */
  initial?: HqRichMenuSeed
  /** 画像を統括の置き場へ上げる（大きさは選んだ形に合わせて口が確かめる）。 */
  uploadImage: (file: File, size: 'large' | 'compact') => Promise<{ r2Key: string }>
  /** 上げた画像の見本の URL。 */
  imageUrl: (r2Key: string) => string
  /** 手順④「配る」の中身（配るアカウント：フォルダの札で絞り、アカウントのカードにチェック）。 */
  distribute: ReactNode
  /** 手順④の右の列「配ると」の行。 */
  distributeSummary: Array<{ key: string; label: string; value: ReactNode }>
  /** 選んだアカウントの数（0 のときは［アカウントへ配る］を押せない）。 */
  selectedCount: number
  busy: boolean
  notice?: ReactNode
  /** 一度に保存する。distribute なら保存のあと選んだアカウントへ配る。 */
  onSave: (seed: HqRichMenuSeed, distribute: boolean) => void
}
