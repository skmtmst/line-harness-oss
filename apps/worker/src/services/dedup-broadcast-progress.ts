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

/**
 * Send a multi-account-dedup broadcast.
 *
 * Called by processBroadcastSend (in broadcast.ts) when
 * broadcast.target_type === 'multi-account-dedup'. Re-runs
 * computeDedupBroadcastPreview at send time (live data, drift from preview by
 * design) to obtain the per-account recipient list, then for each account:
 *   - skip if account is missing or inactive (not a failure)
 *   - send recipients in 500-friend batches with stagger delays
 *   - log per-friend INSERTs into messages_log
 *   - on multicast exception, log the account in failedAccountIds and continue
 *
 * Persists failedAccountIds to broadcasts.failed_account_ids when non-empty.
 * Status determination ('sent' vs 'failed' vs 'sent + partial') is left to
 * the caller (processBroadcastSend) — see broadcast.ts §7.3.
 */
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
 * 容量にはsentIdentKeysだけでなく固定audience全体も含まれる。
 * D1の行/値上限は2,000,000バイト。人数だけから安全とは判定できず、
 * 10店舗×1,000宛先の合成試験でも送信後のJSONはこの制限を超える。
 * 大口対応には固定宛先の行単位保存が必要。送達の正本は既存claimsに保ち、
 * 別の送信leaseやattempt台帳を追加しない。未達条件はdocs/multi-tenant-scale.md。
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
