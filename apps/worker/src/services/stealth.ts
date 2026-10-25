

/** 同時の集中を避けるため、基準遅延へランダムなミリ秒を加える。 */
export function addJitter(baseMs: number, jitterRangeMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterRangeMs);
}


export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 同じ大量送信の文面が完全一致しないよう、ゼロ幅文字や小さな句読点の違いを加える。 */
export function addMessageVariation(text: string, index: number): string {
  // 見た目を変えずに差を付けるため、異なる Unicode の空白をランダムな位置へ入れる。
  const variations = [
    '\u200B', // zero-width space
    '\u200C', // zero-width non-joiner
    '\u200D', // zero-width joiner
    '\uFEFF', // zero-width no-break space
  ];

  // メッセージごとに一定の入力から異なる変化を決める。
  const varChar = variations[index % variations.length];
  const position = (index * 7 + 3) % Math.max(text.length, 1);

  if (text.length === 0) return text;
  return text.slice(0, position) + varChar + text.slice(position);
}

/**
 * LINE のレート制限と自然な送信間隔を守り、Worker の実行時間に API 呼出の余裕を残すため、全バッチの合計遅延を20秒以内にする。
 * 実際の1バッチ人数を使わないとバッチ数を過小評価して遅延が膨らむため、呼出元の batchSize を必須とする。
 * dedup-broadcast の差し込み経路は10人単位でもここを通る。broadcast の差し込み経路はここへ到達せず、通常 multicast は500人単位となる。
 * @param totalMessages 送信対象の総メッセージ数
 * @param batchIndex 現在のバッチ番号（0始まり）
 * @param batchSize 実際の1バッチ人数。multicast は500、差し込み push は10
 * @returns バッチ送信前の遅延（ミリ秒）
 */
export function calculateStaggerDelay(
  totalMessages: number,
  batchIndex: number,
  batchSize = 500,
): number {
  // Cloudflare Worker実行時間制限内に収めるための上限（20秒）
  const MAX_TOTAL_DELAY_MS = 20_000;
  const totalBatches = Math.ceil(totalMessages / Math.max(batchSize, 1));

  if (totalMessages <= 100) {
    // 少量送信: 最小限の遅延 + ジッター
    return addJitter(100, 400);
  }

  // バッチ間遅延を均等に分配（合計が上限を超えないように）
  // batchIndex=0 は遅延なしで呼ばれるため、実際の遅延回数は totalBatches - 1
  const delaySlots = Math.max(totalBatches - 1, 1);
  const baseDelay = Math.min(
    Math.floor(MAX_TOTAL_DELAY_MS / delaySlots),
    5000, // バッチ間の最大遅延を5秒に制限
  );

  return addJitter(baseDelay, Math.min(baseDelay * 0.2, 500));
}

/** 同じ瞬間に配信が集中しないよう、予定へ最大前後5分の揺らぎを加える。 */
export function jitterDeliveryTime(scheduledAt: Date): Date {
  const jitterMinutes = Math.floor(Math.random() * 10) - 5; // 前後5分の範囲で変える。
  const result = new Date(scheduledAt);
  result.setMinutes(result.getMinutes() + jitterMinutes);
  return result;
}

/** LINE API の上限に十分な余裕を持たせ、送信速度を制限する。 */
export class StealthRateLimiter {
  private callCount = 0;
  private windowStart = Date.now();
  private readonly maxCallsPerWindow: number;
  private readonly windowMs: number;

  constructor(maxCallsPerWindow = 1000, windowMs = 60_000) {
    this.maxCallsPerWindow = maxCallsPerWindow;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();


    if (now - this.windowStart >= this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
    }

    // 上限に達したら、制限窓が更新されるまで待つ。
    if (this.callCount >= this.maxCallsPerWindow) {
      const waitTime = this.windowMs - (now - this.windowStart) + addJitter(100, 500);
      await sleep(waitTime);
      this.callCount = 0;
      this.windowStart = Date.now();
    }

    this.callCount++;
  }
}
