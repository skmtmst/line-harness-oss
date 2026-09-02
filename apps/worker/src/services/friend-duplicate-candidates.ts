import { URL_TOKEN_SQL } from '../lib/url-token.js';
import type { DetectIdentityCandidatesResult } from '@line-crm/shared';
import {
  IdentityCandidateError,
  upsertIdentityCandidate,
  type IdentityCandidateDraft,
} from './identity-candidates.js';

const DETECTOR_VERSION = 'profile-image-candidate-v1';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type DuplicateFriendRow = {
  id: string;
  display_name: string | null;
  line_account_id: string;
  line_account_name: string;
  profile_token: string;
};

type CandidatePair = {
  key: string;
  left: DuplicateFriendRow;
  right: DuplicateFriendRow;
};

function encodeCursor(key: string): string {
  return encodeURIComponent(key);
}

function decodeCursor(cursor: string | null | undefined): string {
  if (!cursor) return '';
  try {
    return decodeURIComponent(cursor);
  } catch {
    throw new IdentityCandidateError(422, 'INVALID_DETECTION_CURSOR', '検出の続き位置を読み取れません');
  }
}

export type DetectFriendDuplicateCandidatesInput = {
  tenantId: string;
  allowedAccountIds: string[];
  limit?: number;
  after?: string | null;
  detectedAt?: string;
};

function boundedLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || Number(value) < 1) return DEFAULT_LIMIT;
  return Math.min(Number(value), MAX_LIMIT);
}

function makePairs(rows: DuplicateFriendRow[]): CandidatePair[] {
  const groups = new Map<string, DuplicateFriendRow[]>();
  for (const row of rows) {
    const group = groups.get(row.profile_token) ?? [];
    group.push(row);
    groups.set(row.profile_token, group);
  }

  const pairs: CandidatePair[] = [];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((a, b) => a.id.localeCompare(b.id));
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex];
        const right = sorted[rightIndex];
        if (left.line_account_id === right.line_account_id) continue;
        pairs.push({ key: `${left.id}\u0000${right.id}`, left, right });
      }
    }
  }
  return pairs.sort((a, b) => a.key.localeCompare(b.key));
}

function subject(row: DuplicateFriendRow): IdentityCandidateDraft['left'] {
  return {
    kind: 'friend',
    id: row.id,
    label: row.display_name?.trim() || '名前を取得できません',
    detail: row.line_account_name,
    lineAccountId: row.line_account_id,
    lineAccountName: row.line_account_name,
    shopKey: null,
    attributes: [],
  };
}

/**
 * プロフィール画像の一致を「弱い根拠」の確認候補へ移す。
 *
 * 画像URLや抽出トークンは候補へ保存せず、自動統合にも使わない。候補を作る
 * ところまでに留め、同一人物かどうかは既存の本人照合契約で人が判断する。
 * 1回の処理数を制限し、次のカーソルを返して Workers のsubrequest上限を守る。
 */
export async function detectFriendDuplicateCandidates(
  db: D1Database,
  input: DetectFriendDuplicateCandidatesInput,
): Promise<DetectIdentityCandidatesResult> {
  const allowedAccountIds = [...new Set(input.allowedAccountIds)].sort();
  if (allowedAccountIds.length < 2) {
    return { processed: 0, hasMore: false, nextCursor: null };
  }

  const placeholders = allowedAccountIds.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT f.id, f.display_name, f.line_account_id, la.name AS line_account_name,
            (${URL_TOKEN_SQL}) AS profile_token
       FROM friends f
       JOIN line_accounts la ON la.id = f.line_account_id
      WHERE f.is_following = 1
        AND la.is_active = 1
        AND COALESCE(la.tenant_id, '00000000-0000-4000-8000-000000000001') = ?
        AND f.line_account_id IN (${placeholders})
        AND f.picture_url IS NOT NULL
        AND LENGTH(f.picture_url) > 50
        AND (${URL_TOKEN_SQL}) IS NOT NULL
      ORDER BY f.id ASC`,
  ).bind(input.tenantId, ...allowedAccountIds).all<DuplicateFriendRow>();

  const after = decodeCursor(input.after);
  const pairs = makePairs(result.results).filter((pair) => pair.key > after);
  const limit = boundedLimit(input.limit);
  const selected = pairs.slice(0, limit);
  const detectedAt = input.detectedAt ?? new Date().toISOString();

  for (const pair of selected) {
    await upsertIdentityCandidate(db, {
      tenantId: input.tenantId,
      kind: 'friend_duplicate',
      confidenceScore: 30,
      detectorVersion: DETECTOR_VERSION,
      left: subject(pair.left),
      right: { ...subject(pair.right), kind: 'friend' },
      evidence: [{
        key: 'similar_profile_image',
        label: 'プロフィール画像が似ています',
        strength: 'weak',
        verified: false,
        valuePreview: null,
      }],
      impact: [{
        key: 'duplicate_deliveries',
        label: '重複配信',
        value: null,
        unit: '通',
        note: '配信記録を接続後に表示',
      }],
      detectedAt,
    });
  }

  const hasMore = pairs.length > selected.length;
  return {
    processed: selected.length,
    hasMore,
    nextCursor: hasMore ? encodeCursor(selected.at(-1)?.key ?? '') : null,
  };
}
