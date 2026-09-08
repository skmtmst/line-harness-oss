/** 配信名をOSを問わず保存できるCSVファイル名へ変える。 */
export function broadcastCsvFilename(title: string, id: string): string {
  const safe = title
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  const base = [...safe].slice(0, 80).join('') || `broadcast-${id}`
  return `${base}-配信結果.csv`
}
