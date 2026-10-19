import type { ReactNode } from 'react'
import type { HqRichMenuSeed } from './hq-rich-menu-create'

/**
 * 店のリッチメニューの作る画面（v8/rich-menus/new/create.tsx）を、統括のひな形から使う口（・絵 gobhu・egdGx・K0gu1・gQabc）。
 *
 * 店は手順①〜④のたびにサーバーへ下書きを保存するが、統括のひな形は一度に保存する形。
 * host を渡したときは、手順の間は画面の中に持ち（画像だけは統括の置き場へ先に上げる）、
 * 「下書きを保存」「配る」で一度だけ onSave に渡す。店の動き（host なし）は変えない。
 */
export interface RichMenuCreateHost {
  /** 戻る先（キャンセル・頭の「← リッチメニューへ」）。 */
  backHref: string
  onCancel: () => void
  /** owner・admin だけ保存・配るを押せる。 */
  canOperate: boolean
  folders: Array<{ id: string; name: string; color?: string | null }>
  /** フォルダを選ぶ欄からその場で作る（dLffh）。呼ぶ側の種類のフォルダの口。名前と色を受け取る。 */
  createFolder?: (name: string, color: string | null) => Promise<{ id: string; name: string; color?: string | null }>
  /** ボタンの動きで選べる参照（統括のタグ・テンプレート・回答フォームのひな形。配った先の同じ名前に直す）。 */
  references: { tags: Array<{ id: string; name: string }>; templates: Array<{ id: string; name: string }>; forms: Array<{ id: string; name: string }> }
  /** 直すときに保存してある中身。新しく作るときは無い。 */
  initial?: HqRichMenuSeed
  /** 画像を統括の置き場へ上げる（大きさは選んだ形に合わせて口が確かめる）。 */
  uploadImage: (file: File, size: 'large' | 'compact') => Promise<{ r2Key: string }>
  /** 上げた画像の見本の URL。 */
  imageUrl: (r2Key: string) => string
  /** 手順③「配る先」の頭の段（配るアカウント：1行の欄から共通の窓で選ぶ。絵 ）。 */
  distribute: ReactNode
  /** 選んだアカウントの数。 */
  selectedCount: number
  /** 選んだアカウントの ID（配る前の確認の口に渡す。手順②③の右の列の数）。 */
  selectedIds: string[]
  /** 選んだアカウントの友だちの合計（読めないときは null。③④の右の列「出る人」）。 */
  friendTotal: number | null
  busy: boolean
  notice?: ReactNode
  /**
   * 一度に保存する。distribute なら保存のあと選んだアカウントへ配る。
   * duplicateMode は④「配ったときの扱い」（同じ名前のメニューがあるときに上書きするか・別に作るか）。
   * 配る前の確認（重複の一覧）で初めの選択として入れ、そこで1件ずつ確かめてから配る。
   */
  onSave: (seed: HqRichMenuSeed, distribute: boolean, duplicateMode?: 'overwrite' | 'alias') => void
}
