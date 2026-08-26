/** Decode the three HTML entities that Slack applies to message text. */
export function decodeSlackTextEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
