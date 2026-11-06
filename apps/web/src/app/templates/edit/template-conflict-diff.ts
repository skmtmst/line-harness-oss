/**
 * テンプレートの編集競合（409）の「違いを比べる」で出す差分。
 *
 * 自分の下書きと、相手が保存した最新の版を比べる。
 * 版の履歴APIは無いので、読み直す前に最新を1回取ってその場で比べる。
 */

export type TemplateDraftSide = {
  name: string
  category: string
  folderId: string | null
  messageType: string
  messageContent: string
}

/** 変わった所を運用者の言葉で順に返す。同じなら空。 */
export function describeTemplateDiff(
  mine: TemplateDraftSide,
  incoming: TemplateDraftSide,
): string[] {
  const lines: string[] = []
  if (mine.name !== incoming.name) {
    lines.push(
      `テンプレート名が違います（最新「${incoming.name || '（無題）'}」／あなた「${mine.name || '（無題）'}」）`,
    )
  }
  if (mine.messageType !== incoming.messageType) {
    lines.push('メッセージの形が違います')
  }
  if (mine.messageContent !== incoming.messageContent) {
    lines.push('本文が違います')
  }
  if (
    mine.category !== incoming.category ||
    (mine.folderId ?? '') !== (incoming.folderId ?? '')
  ) {
    lines.push('種類・フォルダが違います')
  }
  return lines
}
