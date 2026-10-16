/*
 * R428: 申告なし・申告不足の本文も上限を超えて読み続けない。
 * 上限を超えたら null を返し、呼び出し側は413にする。
 */
export async function readCappedBodyText(raw: Request, maxBytes: number): Promise<string | null> {
  const reader = raw.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // 読み捨ての中断に失敗しても、413 にはできる。
      }
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
