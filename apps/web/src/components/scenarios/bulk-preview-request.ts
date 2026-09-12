/** 古いプレビュー応答を、後から始めた入力結果へ上書きさせない。 */
export function isCurrentPreviewRequest(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration
}
