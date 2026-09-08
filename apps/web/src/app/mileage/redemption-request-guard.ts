/**
 * アカウント切替で古い応答が後着しないための世代札。
 *
 * 取るたびに世代が進み、あとで「今の世代か」だけ確かめる。
 * 止める口は無い。fetch に Abort を刺すと取得先ごとの差し替え点が増え、
 * 取り違えの素になるので、古い応答の無視で統一する。
 */
export interface RequestGuard {
  issue(): number
  isCurrent(id: number): boolean
}

export function createRequestGuard(): RequestGuard {
  let generation = 0
  return {
    issue() {
      generation += 1
      return generation
    },
    isCurrent(id: number) {
      return id === generation
    },
  }
}
