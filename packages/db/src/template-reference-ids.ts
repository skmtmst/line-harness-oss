/**
 * 一斉配信の保存から、使ったテンプレートを数え直す。
 * 吹き出し (message_bubbles_json) が持つ templateId を読む。本文の写しは
 * 別に残るので、読めない形でも送りは壊れない（参照だけ残さない）。
 */
export function extractBroadcastTemplateIds(bubblesJson: string | null): string[] {
  if (!bubblesJson) return [];
  try {
    const bubbles = JSON.parse(bubblesJson) as Array<{
      content?: { templateId?: unknown };
    }>;
    if (!Array.isArray(bubbles)) return [];
    const ids = bubbles
      .map((bubble) => bubble?.content?.templateId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}
