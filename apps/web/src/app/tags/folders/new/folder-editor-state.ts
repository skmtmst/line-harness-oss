export type FolderRequestKey = {
  editId: string | null
  generation: number
}

/**
 * 同じ画面でクエリだけが切り替わったとき、前の読み込み・保存結果を捨てる。
 * IDだけでは同じフォルダを読み直した場合を区別できないため、世代も照合する。
 */
export function isCurrentFolderRequest(
  current: FolderRequestKey,
  settled: FolderRequestKey,
): boolean {
  return current.editId === settled.editId && current.generation === settled.generation
}

/** APIやDBの文言をそのまま画面へ出さず、運用者が次に取る行動を返す。 */
export function folderSaveErrorMessage(status?: number): string {
  switch (status) {
    case 400:
      return '入力内容を確認してください。フォルダ名は60文字以内で入力してください。'
    case 403:
      return 'フォルダを変更する権限がありません。管理者に確認してください。'
    case 404:
      return 'フォルダが見つかりません。一覧へ戻って最新の状態を確認してください。'
    case 409:
      return 'ほかの担当者が先に変更しました。最新の内容を読み直してください。'
    default:
      return '保存できませんでした。時間を置いて、もう一度お試しください。'
  }
}
