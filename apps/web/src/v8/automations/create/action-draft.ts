export type ActionType = string

export interface ActionDraft {
  /** 行を取り違えないための、画面の中だけの番号。 */
  key: number
  /** 読み込んだ処理のID。名前だけの保存や並べ替えで別の処理にしない。 */
  sourceId?: string
  type: ActionType
  tagId: string
  message: string
  scenarioId: string
  /** #942 N-356: 共通アクションを呼ぶときの選択。 */
  commonActionId: string
  /**
   * 担当へ知らせる（notify_staff）の中身。この画面では選び直せないので、
   * 読んだ下書き（見本から作ったもの）の知らせのルールと文面をそのまま持って戻す。
   * 持たずに保存すると、見本の「担当へ知らせる」が文面の送信に化けて消える。
   */
  kept?: Record<string, unknown>
}
