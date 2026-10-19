'use client'

/** 作ってあるもの（回答フォーム・予約メニュー・スタンプカード）1つ。 */
export interface TapActionSourceItem {
  id: string
  name: string
  /** 名前の横の小さな補足（「10個で1杯サービス」など）。 */
  note?: string
  /** 新しくは選べない（受け付けを止めた回答フォームなど）。選んであるときは名前と補足を出す。 */
  disabled?: boolean
  /** フォルダ（回答フォーム）。undefined＝フォルダの無い種類。 */
  folderId?: string | null
  /** 最後に直した日時（選ぶ窓の行の補足）。 */
  updatedAt?: string | null
}

export type TapActionSources = Partial<Record<'form' | 'booking' | 'visit_stamp', TapActionSourceItem[]>>
