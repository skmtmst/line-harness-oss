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

/**
 * 使い道の一覧と届かなかった交換は、別々の札で読む。
 *
 * 1つの札を2つの取得で使い回すと、開いた瞬間に後から取った方が
 * 先に取った方を古くしてしまう。一覧の応答が捨てられ、
 * 通常表示が loading のまま残る。取得ごとに札を持つ。
 */
export interface MileageRewardsFetchGuards {
  overview: RequestGuard
  redemptions: RequestGuard
}

export function createMileageRewardsFetchGuards(): MileageRewardsFetchGuards {
  return { overview: createRequestGuard(), redemptions: createRequestGuard() }
}

/**
 * やり直しボタン用の店の世代札。押したときの店と、応答が返ったときの
 * 店を比べる。A の店で押して B へ切り替えたあと、A の古い閉じ込めが
 * 新しい世代として A を読み直し、B の画面へ混ぜないためのもの。
 * 世代まで見るのは、A→B→A と戻ったときに古い A と今の A を分けるため。
 */
export interface AccountOperation {
  accountId: string | null
  generation: number
}

export interface AccountTracker {
  track(accountId: string | null): AccountOperation
  isCurrent(operation: AccountOperation): boolean
}

export function createAccountTracker(): AccountTracker {
  let currentAccountId: string | null = null
  let generation = 0
  let initialized = false
  return {
    track(accountId: string | null) {
      if (!initialized || accountId !== currentAccountId) {
        currentAccountId = accountId
        generation += 1
        initialized = true
      }
      return { accountId: currentAccountId, generation }
    },
    isCurrent(operation: AccountOperation) {
      return initialized
        && operation.accountId === currentAccountId
        && operation.generation === generation
    },
  }
}
