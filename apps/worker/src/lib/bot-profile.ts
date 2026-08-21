/**
 * LINE公式アカウントの看板（表示名・アイコン・ベーシックID）を LINE から読む。
 *
 * DB の `line_accounts.name` は運用側が付けた呼び名で、LINE の管理画面で
 * 変えた表示名やアイコンは反映されない。友だちに見えているのはこちらなので、
 * 画面に出すときは LINE から取った値を優先する。
 *
 * アカウント一覧（/api/line-accounts）とログイン画面の看板
 * （/api/public/brand）の2か所から呼ぶ。片方だけ直して見え方がずれるのを
 * 避けるため、取得はここ1か所に置く。
 */
export interface BotProfile {
  displayName?: string;
  pictureUrl?: string;
  basicId?: string;
}

/**
 * 失敗しても投げない。看板が取れないことは、画面を出せない理由にはならない。
 * 呼ぶ側は空の戻りを見て、DB 側の呼び名などにフォールバックする。
 */
export async function fetchBotProfile(accessToken: string): Promise<BotProfile> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as BotProfile;
    return { displayName: data.displayName, pictureUrl: data.pictureUrl, basicId: data.basicId };
  } catch {
    return {};
  }
}
