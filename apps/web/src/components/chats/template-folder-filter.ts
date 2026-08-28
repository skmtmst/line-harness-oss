export const UNFILED_TEMPLATE_FOLDER_ID = '__none__'

export function templateMatchesFolder(
  templateFolderId: string | null | undefined,
  selectedFolderId: string,
): boolean {
  if (!selectedFolderId) return true
  if (selectedFolderId === UNFILED_TEMPLATE_FOLDER_ID) return !templateFolderId
  return templateFolderId === selectedFolderId
}
