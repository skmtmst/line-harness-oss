/**
 * 同じ送信内容を再試行するときだけ同じキーを返す。
 * 成功後に clear すると、次の送信は新しい操作として別キーになる。
 */
export class IdempotencyKeyStore {
  private readonly keys = new Map<string, string>()

  get(signature: string): string {
    const existing = this.keys.get(signature)
    if (existing) return existing
    const created = crypto.randomUUID()
    this.keys.set(signature, created)
    return created
  }

  clear(signature: string): void {
    this.keys.delete(signature)
  }
}
