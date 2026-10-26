/** 本線に無いので見本に出さない言葉（別の会議の道具・月謝・ベルの知らせ・会議の URL）。試験だけが読む。 */
export const FORBIDDEN_DEMO_TEXT = ['Zoom', 'zoom.us', '月謝', 'ベル', 'meet.google.com/']

/** 台本の中の文字を全部集める。 */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, out))
  return out
}
