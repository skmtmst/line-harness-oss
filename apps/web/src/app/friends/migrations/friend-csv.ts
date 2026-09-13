export type FriendImportRow = {
  lineUid: string
  displayName: string | null
  realName: string | null
  systemDisplayName: string | null
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += character
    }
  }

  cells.push(cell)
  return cells
}

export function parseFriendCsv(text: string): FriendImportRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((value) => value.trim())
  const headerIndex = (...names: string[]) => headers.findIndex((value) => names.includes(value))
  const uid = headerIndex('LINEユーザーID', 'line_user_id', 'lineUid')
  if (uid < 0) return []
  const display = headerIndex('LINE表示名', 'display_name', 'displayName')
  const real = headerIndex('本名', 'real_name', 'realName')
  const system = headerIndex('システム表示名', 'system_display_name', 'systemDisplayName')
  const value = (cells: string[], position: number) => position < 0 ? null : cells[position]?.trim() || null

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return {
      lineUid: value(cells, uid) ?? '',
      displayName: value(cells, display),
      realName: value(cells, real),
      systemDisplayName: value(cells, system),
    }
  }).filter((row) => row.lineUid)
}
