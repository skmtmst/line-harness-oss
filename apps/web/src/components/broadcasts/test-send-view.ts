export type TestSendView = {
  kind: 'success' | 'partial' | 'error'
  message: string
}

/** 送れなかった人がいる結果を、成功の緑色で表示しない。 */
export function testSendResult(sent: number, failed: number, at: string): TestSendView {
  if (failed > 0) {
    return {
      kind: 'partial',
      message: `${at} 一部を送信できませんでした (${sent}名成功, ${failed}名失敗)`,
    }
  }
  if (sent <= 0) {
    return {
      kind: 'error',
      message: `${at} テスト送信できませんでした（送信先を確認してください）`,
    }
  }
  return { kind: 'success', message: `${at} テスト送信済み (${sent}名成功)` }
}

export function testSendFailure(at: string): TestSendView {
  return { kind: 'error', message: `${at} テスト送信に失敗しました` }
}
