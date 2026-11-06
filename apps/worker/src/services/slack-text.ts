/** Slack が本文へ使う3種類の HTML 実体参照だけを復号する。 */
export function decodeSlackTextEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
