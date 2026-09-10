/**
 * アカウント切替の世代guard。非同期の応答が遅れて届いたとき、
 * 別アカウントの値を画面へ混ぜない。Aで取り、Bで受けたら捨てる。
 */
export type AccountRequestTicket = {
  readonly accountId: string
  readonly generation: number
}

export function createAccountRequestGuard() {
  let generation = 0
  return {
    /** アカウントが変わったら呼ぶ。以降の古い切符は無効になる。 */
    advance() {
      generation += 1
    },
    /** 処理開始時に切符を取る。 */
    issue(accountId: string): AccountRequestTicket {
      return { accountId, generation }
    },
    /** 応答適用前に確かめる。切替後は偽になる。 */
    isCurrent(ticket: AccountRequestTicket, accountId: string): boolean {
      return ticket.generation === generation && ticket.accountId === accountId
    },
  }
}
