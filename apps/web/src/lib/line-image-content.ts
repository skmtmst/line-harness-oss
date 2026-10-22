/** LINE送信画像の中身。{originalContentUrl, previewImageUrl} の JSON。 */
export function readLineImageContent(content: string): { originalContentUrl: string; previewImageUrl: string } | null {
  try {
    const parsed = JSON.parse(content) as {
      originalContentUrl?: unknown
      previewImageUrl?: unknown
    }
    if (typeof parsed.originalContentUrl === 'string' && parsed.originalContentUrl) {
      return {
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl:
          typeof parsed.previewImageUrl === 'string' && parsed.previewImageUrl
            ? parsed.previewImageUrl
            : parsed.originalContentUrl,
      }
    }
  } catch {
    /* JSON でなければ画像の中身ではない */
  }
  return null
}
