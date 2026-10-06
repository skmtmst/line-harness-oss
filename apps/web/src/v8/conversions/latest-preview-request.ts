export type LatestPreviewRequest = {
  signal: AbortSignal
  isCurrent: () => boolean
  abort: () => void
}

/**
 * 入力を続けて変えたとき、前の重い試算を中断し、古い応答を無効にする。
 * fetch側が中断を無視して応答しても、世代番号で画面への反映を防ぐ。
 */
export function createLatestPreviewRequestGate() {
  let generation = 0
  let activeController: AbortController | null = null

  return {
    start(): LatestPreviewRequest {
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      const requestGeneration = ++generation
      return {
        signal: controller.signal,
        isCurrent: () => !controller.signal.aborted && requestGeneration === generation,
        abort: () => {
          controller.abort()
          if (requestGeneration === generation) generation += 1
        },
      }
    },
  }
}
