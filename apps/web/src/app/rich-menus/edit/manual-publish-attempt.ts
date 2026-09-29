/** 手動公開1回分の鍵と二重実行ガード。失敗なら鍵を残し、成功だけ次の鍵へ進める。 */
export class ManualPublishAttempt {
  private key: string | null = null
  private running = false

  begin(): string | null {
    if (this.running) return null
    this.running = true
    this.key ??= crypto.randomUUID()
    return this.key
  }

  succeed() { this.key = null }
  finish() { this.running = false }
}
