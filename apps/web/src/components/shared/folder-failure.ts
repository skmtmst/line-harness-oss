/*
 * フォルダの保存・消すが失敗したときの言葉（2026-10-09 オーナー：統括のタグのひな形で「フォルダを保存できませんでした」
 * としか出ず、理由が分からなかった）。理由ごとに言い分け、読めない理由のときも状態番号と理由の符号を小さく添える
 * （司令塔が原因を追えるように）。どの一覧のフォルダの窓も、この1か所で言葉を決める。
 */

export type FolderFailureKind = 'conflict' | 'name' | 'missing' | 'color' | 'forbidden' | 'network' | 'unknown'

export interface FolderFailure {
  kind: FolderFailureKind
  message: string
  /** 名前の欄を赤くするとき（同じ名前がある）。 */
  nameError?: string
}

function statusAndCode(err: unknown): { status?: number; code?: string } {
  if (!err || typeof err !== 'object') return {}
  const value = err as { status?: unknown; code?: unknown; cause?: unknown }
  const status = typeof value.status === 'number' ? value.status : undefined
  const code = typeof value.code === 'string' && value.code ? value.code : undefined
  if ((status === undefined || code === undefined) && value.cause && value.cause !== err) {
    const inner = statusAndCode(value.cause)
    return { status: status ?? inner.status, code: code ?? inner.code }
  }
  return { status, code }
}

/** 通信そのものが届かなかった（fetch の TypeError・状態番号の無い失敗）。 */
function isNetworkFailure(err: unknown, status: number | undefined) {
  if (status !== undefined && status > 0) return false
  if (err instanceof TypeError) return true
  return status === 0
}

/**
 * @param action 「保存」か「消す」。読めない理由のときの言葉に使う。
 */
export function describeFolderFailure(err: unknown, action: 'save' | 'delete' = 'save'): FolderFailure {
  const { status, code } = statusAndCode(err)
  if (code === 'VERSION_CONFLICT' || (status === 409 && code === undefined && action === 'delete')) {
    return { kind: 'conflict', message: `ほかの人が先に直しました。最新の内容を読み込みました。もう一度${action === 'save' ? '保存' : '消す操作を'}してください。` }
  }
  if (code === 'FOLDER_NAME_CONFLICT' || code === 'DUPLICATE_NAME' || code === 'NAME_CONFLICT' || (status === 409 && action === 'save' && code === undefined)) {
    return { kind: 'name', message: '同じ名前のフォルダがあります。', nameError: '同じ名前のフォルダがあります。' }
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return { kind: 'missing', message: 'このフォルダは消されています。' }
  }
  if (code === 'INVALID_FOLDER_COLOR') {
    return { kind: 'color', message: 'この色は選べません。ほかの色を選んでください。' }
  }
  if (status === 403 || code === 'FORBIDDEN') {
    return { kind: 'forbidden', message: 'フォルダを変える権限がありません。オーナーか管理者に頼んでください。' }
  }
  if (isNetworkFailure(err, status)) {
    return { kind: 'network', message: 'つながりませんでした。もう一度お試しください。' }
  }
  const verb = action === 'save' ? '保存できませんでした' : '消せませんでした'
  const parts = [status !== undefined ? `状態 ${status}` : null, code ?? null].filter(Boolean)
  return { kind: 'unknown', message: `フォルダを${verb}。${parts.length ? `（${parts.join('・')}）` : ''}` }
}
