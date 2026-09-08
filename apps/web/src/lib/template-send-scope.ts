/**
 * 送信候補のテンプレート選び(#645 差し戻し・要件1/4)。
 *
 * チャットのテンプレート選択と一斉配信の作成は、公開版だけを候補にする。
 * 編集中の下書きや、まだ一度も公開していない未公開は選ばせない。
 * アカウントの取り違えもここで弾く(サーバ側の account_id 絞り込みと二重化)。
 *
 * 目印がない古い応答(撮影用モックなど)は通す。本物の口は必ず目印を返すので、
 * 「未公開と分かったものだけ落とす」にしている。モックを直さず絵を保つため。
 */

export interface SendableTemplateCandidate {
  id: string
  accountId?: string | null
  /** 公開版の版番号。未公開は0。本物の口は必ず返す。 */
  publishedVersion?: number | null
  /** 最後に公開した日時。未公開はnull。本物の口は必ず返す。 */
  publishedAt?: string | null
}

/**
 * 送ってよい候補かどうか。
 *
 * - 未公開と分かったもの(公開日時なし・版0)は候補にしない
 * - 持ち主が分かり、選んでいるLINEアカウントと違うものは候補にしない
 */
export function isSendableTemplate(
  template: SendableTemplateCandidate,
  selectedAccountId?: string | null,
): boolean {
  if (template.publishedAt === null) return false
  if (template.publishedVersion === 0) return false
  if (
    selectedAccountId &&
    template.accountId != null &&
    template.accountId !== selectedAccountId
  ) {
    return false
  }
  return true
}

/** 候補一覧から送ってよいものだけを残す。順番は変えない。 */
export function filterSendableTemplates<T extends SendableTemplateCandidate>(
  templates: T[],
  selectedAccountId?: string | null,
): T[] {
  return templates.filter((template) => isSendableTemplate(template, selectedAccountId))
}

/**
 * 読み込みの世代照合(独立審査指摘4)。
 * アカウント切替などで読み直すたびに世代を進め、古い応答の描画を止める。
 * 遅延Promiseが順不同で返っても、最新の世代だけが生かされる。
 */
export interface LoadGeneration {
  /** 新しい読み込みを始める。返った番号がこの読み込みの世代。 */
  next: () => number
  /** その世代が最新かどうか。最新でなければ描画しない。 */
  isCurrent: (generation: number) => boolean
}

export function createLoadGeneration(): LoadGeneration {
  let current = 0
  return {
    next: () => {
      current += 1
      return current
    },
    isCurrent: (generation: number) => generation === current,
  }
}
