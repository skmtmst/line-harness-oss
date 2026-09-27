/**
 * 一斉配信の宛先台帳・記録・10の状態（#816）。
 *
 * 画面に見せる「いまどの状態か」と「宛先ごとの結果の言い方」を決める。
 * `broadcasts.status` の CHECK（draft/scheduled/sending/sent）は変えられない
 * ので（表の作り直し禁止）、10の状態は status・承認・停止・台帳の集計から
 * 組み立てる。保存する軸を増やさない。
 */
export type BroadcastDisplayStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'preparing'
  | 'sending'
  | 'sent'
  | 'partial_failed'
  | 'failed'
  | 'stopped'
  | 'expired';

export const BROADCAST_DISPLAY_STATUS_LABELS: Record<BroadcastDisplayStatus, string> = {
  draft: '下書き',
  pending_approval: '承認待ち',
  scheduled: '予約済み',
  preparing: '送信準備',
  sending: '送信中',
  sent: '送信済み',
  partial_failed: '一部失敗',
  failed: '失敗',
  stopped: '停止',
  expired: '期限切れ',
};

/**
 * 一時的な失敗（送り直してよい）の理由コード。
 *
 * 台帳に残る error_code のうち、もう一度送る意味があるのはこの2つだけ。
 * 429 は混み合い（時間を置けば通る）。stopped_before_dispatch は止めたときに
 * 外へ出す前だった行（誰にも届いていないので送り直してよい）。
 * それ以外の 4xx（相手のブロック・友だち解除など）は送り直しても通らない。
 */
export const BROADCAST_TEMPORARY_ERROR_CODES = [
  'line_http_429',
  'stopped_before_dispatch',
] as const;

export function isTemporaryLedgerErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (BROADCAST_TEMPORARY_ERROR_CODES as readonly string[]).includes(code);
}

export type BroadcastRecipientGroup =
  | 'delivered'
  | 'failed_temporary'
  | 'failed_permanent'
  | 'unknown'
  | 'inflight';

export interface BroadcastRecipientView {
  group: BroadcastRecipientGroup;
  /** 人の言葉の札（「届いた」「失敗：一時的」など）。 */
  label: string;
  /** 詳しい理由（画面の注・CSVに出す）。 */
  detail: string;
  retryable: boolean;
}

const RECIPIENT_VIEWS: Record<BroadcastRecipientGroup, BroadcastRecipientView> = {
  delivered: { group: 'delivered', label: '届いた', detail: 'LINEが受け付けました', retryable: false },
  failed_temporary: {
    group: 'failed_temporary',
    label: '失敗：一時的（あとで再送できます）',
    detail: '混み合いなどで送れませんでした。時間を置いて送り直せます',
    retryable: true,
  },
  failed_permanent: {
    group: 'failed_permanent',
    label: '失敗：届けられませんでした',
    detail: 'ブロック・友だち解除などで受け付けられませんでした。送り直しません',
    retryable: false,
  },
  unknown: {
    group: 'unknown',
    label: '送達不明',
    detail: '外へ出たかもしれません。二重に届くのを避けるため送り直しません',
    retryable: false,
  },
  inflight: { group: 'inflight', label: '送信中', detail: 'いま送っているところです', retryable: false },
};

/**
 * 台帳の1行を、画面の札に分ける。
 *
 * LINE の multicast は宛先ごとの理由を返さないので、「ブロック」「友だちで
 * ない」の切り分けはできない。4xx はまとめて「届けられませんでした」と出し、
 * 理由の推測を札に書かない。
 */
export function classifyBroadcastRecipient(
  state: string,
  errorCode: string | null | undefined,
): BroadcastRecipientView {
  if (state === 'sent') return RECIPIENT_VIEWS.delivered;
  if (state === 'unknown') return RECIPIENT_VIEWS.unknown;
  if (state === 'failed') {
    return isTemporaryLedgerErrorCode(errorCode)
      ? RECIPIENT_VIEWS.failed_temporary
      : RECIPIENT_VIEWS.failed_permanent;
  }
  return RECIPIENT_VIEWS.inflight;
}

export interface BroadcastDisplayStatusInput {
  status: string;
  approvalStatus: string | null | undefined;
  /** 予約の時刻（JST文字列）。承認待ちの期限切れ判定に使う。 */
  scheduledAt: string | null | undefined;
  stopped: boolean;
  sent: number;
  failed: number;
  unknown: number;
  /** 台帳の行数（sent + failed + unknown + claimed）。0 の送信中は「送信準備」。 */
  ledgerRows: number;
  nowMs?: number;
}

/**
 * 10の状態を決める。優先順位は上から。
 *
 * 承認待ち・期限切れが先なのは、二者承認（#A）が「承認が済むまで送らない」
 * 決まりだから。承認が要る配信は、status が何であれ承認の軸で見せる。
 */
export function deriveBroadcastDisplayStatus(input: BroadcastDisplayStatusInput): BroadcastDisplayStatus {
  const approval = input.approvalStatus ?? 'none';
  if (approval === 'pending') {
    if (input.scheduledAt) {
      const now = input.nowMs ?? Date.now();
      const scheduledMs = Date.parse(input.scheduledAt);
      if (Number.isFinite(scheduledMs) && scheduledMs <= now) return 'expired';
    }
    return 'pending_approval';
  }
  if (approval === 'expired') return 'expired';
  if (input.stopped) return 'stopped';
  switch (input.status) {
    case 'draft':
      return 'draft';
    case 'scheduled':
      return 'scheduled';
    case 'sending':
      return input.ledgerRows > 0 ? 'sending' : 'preparing';
    case 'sent': {
      if (input.failed > 0) return input.sent > 0 ? 'partial_failed' : 'failed';
      if (input.sent === 0 && input.unknown > 0) return 'failed';
      return 'sent';
    }
    default:
      return 'draft';
  }
}
