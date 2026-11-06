export interface DedupPreviewPerAccount {
  accountId: string;
  accountName: string;
  accountCountry: string | null;
  selectedCount: number;
  sendCount: number;
  excludedToHigherPriority: number;
  // identKey: dedup の正規化 ID (URL_TOKEN_SQL / 'uid:'||user_id / 'solo:'||friend_id)。
  // resume 時の send 済判定に使う。lineUserId はプロバイダ単位のID なので、
  // 同じ論理人物が別 LINE 公式アカウント (別プロバイダ) にいる場合に二重配信
  // する事故を防ぐため、cross-account でユニークな identKey を採用する。
  recipients: Array<{
    friendId: string;
    lineUserId: string;
    identKey: string;
    displayName: string | null;
  }>;
}

export interface DedupPreviewResult {
  totalSelected: number;
  uniqueRecipients: number;
  reduction: number;
  reductionRate: number;
  perAccount: DedupPreviewPerAccount[];
}

/** 送信時に実データで重複除外を再計算し、アカウント別に500人単位で送る。停止・不存在は飛ばし、送信失敗はアカウントを記録して残りを続ける。最終状態の判定は呼出元へ委ねる。 */
/**
 * dedup broadcast の resume 用進捗。broadcasts.dedup_progress JSON カラムに保存。
 *
 * sentIdentKeys: dedup の正規化 ID (URL_TOKEN / uid:user_id / solo:friend_id) のうち
 *                既に multicast 済のもの全体集合。**アカウント横断で共有**する。
 *
 * 設計理由:
 *   - per-account の lineUserId 集合だと、resume 時に dedup 勝者が別アカウントに
 *     遷移したケース (account A が unfollow / tag 喪失 → 同じ logical person が
 *     account B で勝者になる) で新しい lineUserId が「未送信扱い」となり、結果
 *     同じ人物に二重配信される。
 *   - identKey は dedup の意味論上ユニークな key なので、横断 set で持てば論理
 *     重複を完全に防げる。
 *
 * 容量見積り: 2000 人 × ~40 文字 (url_token または uid:UUID) = ~80KB。
 * D1 row 1MB 上限内。
 *
 * **スケール限界**: ~25,000 人を超える broadcast では JSON サイズが 1MB を超え、
 * UPDATE が失敗してその時点で resume 機能が止まる (multicast 自体は LINE 側に
 * 届くが、進捗は記録されない → 完了時に重複扱いになる)。それ以上の規模が
 * 必要になったら別テーブル `broadcast_dedup_progress(broadcast_id, ident_key)` に
 * row 単位で持つ設計へ移行すること (現状は対応せず、コメントで明示)。
 *
 * 安全マージン: 2000-5000 人なら問題なし。10000 人で要監視 (~400KB)。
 */
export interface DedupProgress {
  sentIdentKeys: string[];
  audience?: DedupPreviewResult;
}

export function parseProgress(raw: string | null | undefined): DedupProgress {
  const empty: DedupProgress = { sentIdentKeys: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { sentIdentKeys?: unknown }).sentIdentKeys)) {
      return {
        ...(parsed.audience ? { audience: parsed.audience as DedupPreviewResult } : {}),
        sentIdentKeys: (parsed as { sentIdentKeys: unknown[] }).sentIdentKeys
          .filter((s): s is string => typeof s === 'string'),
      };
    }
  } catch {
    // ignore — corrupt JSON は最初からやり直す
  }
  return empty;
}
