/**
 * 模擬の `GET /api/folders?kind=template`。本物の口と同じく、フォルダごとの件数（itemCount）と
 * 未分類の件数（unfiledCount）を返す。section（今のタブの種類）があれば、その種類のテンプレートだけを数える。
 */
function isRichVideo(item) {
  if (item.messageType !== 'imagemap') return false
  try { return Boolean(JSON.parse(item.draftMessageContent ?? item.messageContent).video) } catch { return false }
}

function inSection(item, section) {
  if (section === 'rich_video') return isRichVideo(item)
  if (section === 'question') return Boolean(item.question)
  return !item.question && !isRichVideo(item)
}

export function templateFolderList(templates, folders, section) {
  if (!section) {
    return {
      success: true,
      data: folders.map((folder) => ({ ...folder, itemCount: folder.templateCount })),
      unfiledCount: templates.filter((item) => item.folderId === null).length,
    }
  }
  const items = templates.filter((item) => inSection(item, section))
  return {
    success: true,
    data: folders.map((folder) => ({ ...folder, itemCount: items.filter((item) => item.folderId === folder.id).length })),
    unfiledCount: items.filter((item) => item.folderId === null).length,
  }
}
