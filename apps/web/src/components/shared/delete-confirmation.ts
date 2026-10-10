/** 削除の対象名と実行の文言は、単件・一括ともこの口でそろえる。 */
export const deleteConfirmationTitle = (name: string) => `「${name}」を削除しますか？`
export function normalizeDeleteTitle(title: string): string {
  const quoted = title.match(/「(.+)」.*(?:削除|消)/)
  if (quoted) return deleteConfirmationTitle(quoted[1])
  const target = title.match(/^(.+?)を(?:まとめて)?(?:削除|消)/)
  if (!target) return title
  const name = /^\d+件$/.test(target[1]) ? `選択した${target[1]}` : target[1]
  return deleteConfirmationTitle(name)
}


export const isDeleteConfirmation = (label: string) => label.includes('削除') || label === '消す' || label.endsWith('を消す') || label.includes('移して消す')
