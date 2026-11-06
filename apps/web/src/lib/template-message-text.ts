/** 古い文字テンプレートの保存形式も、本文だけを全長で読み出す。 */
export function readTemplateText(content: string): string {
  if (!content.trimStart().startsWith('{')) return content
  try {
    const payload: unknown = JSON.parse(content)
    if (payload && typeof payload === 'object' && !Array.isArray(payload) &&
      'text' in payload && typeof payload.text === 'string') return payload.text
  } catch { /* 通常の文章にある括弧や、読めない保存値は書き換えない。 */ }
  return content
}
