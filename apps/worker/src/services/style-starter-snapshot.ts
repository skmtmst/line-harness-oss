/** 旧保存形の text 包みだけを、送信する本文の文字へ正規化する。 */
function plainText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.keys(parsed).length === 1 && 'text' in parsed && typeof parsed.text === 'string') return parsed.text;
  } catch { /* 通常の本文は JSON ではない。 */ }
  return value;
}

function normalized(kind: string, snapshot: string): string {
  const value = JSON.parse(snapshot);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return snapshot;
  if (kind === 'template' && value.type === 'text') value.content = plainText(value.content);
  if (kind === 'reminder' && Array.isArray(value.versions)) {
    for (const version of value.versions) {
      if (typeof version.settings !== 'string') continue;
      const settings = JSON.parse(version.settings);
      if (!Array.isArray(settings?.steps)) continue;
      for (const step of settings.steps) {
        if (step.messageType === 'text') step.messageContent = plainText(step.messageContent);
      }
      version.settings = JSON.stringify(settings);
      // 型が分かる本文だけを照合する。混在・不明の段は推測しない。
      if (settings.steps.every((step: { messageType?: string }) => step.messageType === 'text')
        && Array.isArray(version.steps)) {
        for (const step of version.steps) step.content = plainText(step.content);
      }
    }
  }
  return JSON.stringify(value);
}

/** 表示形式だけの差を許し、ほかの項目と SQL の同時更新ガードは厳密に保つ。 */
export function sameStarterSnapshot(kind: string, actual: string | null, expected: string | null): boolean {
  if (actual === null || expected === null) return false;
  if (actual === expected) return true;
  if (kind !== 'template' && kind !== 'reminder') return false;
  try { return normalized(kind, actual) === normalized(kind, expected); }
  catch { return false; }
}
