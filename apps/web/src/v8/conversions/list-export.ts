
export function downloadCsvBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(href)
}


export const DAY_MS = 24 * 60 * 60 * 1000

export function definitionRange(days: number): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * DAY_MS)
  const format = (value: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value)
  return { from: format(start), to: format(end) }
}
