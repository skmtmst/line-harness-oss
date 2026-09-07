import type {
  MergedPersonJsonValue,
  MergedPersonProfileSelectionInput,
  MergedPersonProfileUpdateMode,
} from '@line-crm/shared';

type FriendValueRow = {
  id: string;
  display_name: string | null;
  real_name: string | null;
  system_display_name: string | null;
  status_message: string | null;
  metadata: string | null;
};

type TagRow = {
  id: string;
  name: string;
  color: string | null;
  friend_id: string;
};

export type FriendProfileCandidateOption = {
  candidateId: string;
  sourceFriendId: string;
  sourceLabel: string;
  valuePreview: string | null;
  verified: boolean;
};

export type FriendProfileCandidate = {
  fieldKey: string;
  fieldLabel: string;
  options: FriendProfileCandidateOption[];
};

export type FriendTagCandidate = {
  id: string;
  name: string;
  color: string | null;
  sourceFriendIds: string[];
};

type SelectionReference = {
  fieldKey: string;
  sourceFriendId: string;
  updateMode: MergedPersonProfileUpdateMode;
};

export type ProfileCandidateSelectionReference = {
  fieldKey: string;
  candidateId: string;
  updateMode: MergedPersonProfileUpdateMode;
};

const FIELD_LABELS: Record<string, string> = {
  display_name: 'LINE表示名',
  real_name: '本名',
  system_display_name: 'システム表示名',
  status_message: 'ステータスメッセージ',
};
const FIELD_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;

const RAW_EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const RAW_PHONE = /(?:\+?\d[\s().-]*){10,15}/g;

function maskPreview(value: MergedPersonJsonValue): string | null {
  if (value === null) return null;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw
    .replace(RAW_EMAIL, (email) => {
      const at = email.indexOf('@');
      return at > 0 ? `${email.slice(0, 1)}***${email.slice(at)}` : '***';
    })
    .replace(RAW_PHONE, (phone) => `${phone.slice(0, 2)}***${phone.slice(-2)}`)
    .slice(0, 200);
}

function metadata(row: FriendValueRow): Record<string, MergedPersonJsonValue> {
  try {
    const parsed = JSON.parse(row.metadata || '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, MergedPersonJsonValue>
      : {};
  } catch {
    return {};
  }
}

function sourceValue(row: FriendValueRow, fieldKey: string): MergedPersonJsonValue | undefined {
  if (fieldKey === 'display_name') return row.display_name;
  if (fieldKey === 'real_name') return row.real_name;
  if (fieldKey === 'system_display_name') return row.system_display_name;
  if (fieldKey === 'status_message') return row.status_message;
  if (fieldKey.startsWith('metadata.')) return metadata(row)[fieldKey.slice('metadata.'.length)];
  return undefined;
}

/** 候補を見た時点の値へ結び付ける。元データが変われば同じIDでは採用できない。 */
async function profileCandidateId(
  fieldKey: string,
  sourceFriendId: string,
  value: MergedPersonJsonValue,
): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify([fieldKey, sourceFriendId, value]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return `pc_${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function friendRows(db: D1Database, friendIds: string[]): Promise<FriendValueRow[]> {
  const ids = [...new Set(friendIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT id, display_name, real_name, system_display_name, status_message, metadata
       FROM friends WHERE id IN (${placeholders}) ORDER BY id`,
  ).bind(...ids).all<FriendValueRow>();
  return result.results;
}

export async function getFriendProfileCandidates(
  db: D1Database,
  friendIds: string[],
): Promise<{ profileCandidates: FriendProfileCandidate[]; tagCandidates: FriendTagCandidate[] }> {
  const rows = await friendRows(db, friendIds);
  const fields = new Map<string, FriendProfileCandidate>();
  for (const row of rows) {
    const values: ReadonlyArray<readonly [string, string, MergedPersonJsonValue | undefined]> = [
      ...Object.entries(FIELD_LABELS).map(([key, label]) => [key, label, sourceValue(row, key)] as const),
      ...Object.entries(metadata(row))
        .filter(([key]) => FIELD_KEY.test(`metadata.${key}`))
        .map(([key, value]) => [`metadata.${key}`, key, value] as const),
    ];
    for (const [fieldKey, fieldLabel, value] of values) {
      if (value === undefined || value === null || value === '') continue;
      const candidate = fields.get(fieldKey) ?? { fieldKey, fieldLabel, options: [] };
      candidate.options.push({
        candidateId: await profileCandidateId(fieldKey, row.id, value),
        sourceFriendId: row.id,
        sourceLabel: row.display_name || '名前は未取得',
        valuePreview: maskPreview(value),
        verified: false,
      });
      fields.set(fieldKey, candidate);
    }
  }

  const ids = rows.map((row) => row.id);
  const tags = ids.length
    ? await db.prepare(
      `SELECT t.id, t.name, t.color, ft.friend_id
         FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id
        WHERE ft.friend_id IN (${ids.map(() => '?').join(', ')})
        ORDER BY t.name, t.id, ft.friend_id`,
    ).bind(...ids).all<TagRow>()
    : { results: [] as TagRow[] };
  const tagMap = new Map<string, FriendTagCandidate>();
  for (const row of tags.results) {
    const item = tagMap.get(row.id) ?? {
      id: row.id, name: row.name, color: row.color, sourceFriendIds: [],
    };
    item.sourceFriendIds.push(row.friend_id);
    tagMap.set(row.id, item);
  }
  return {
    profileCandidates: [...fields.values()],
    tagCandidates: [...tagMap.values()],
  };
}

export async function resolveProfileCandidateSelections(
  db: D1Database,
  friendIds: string[],
  selections: ProfileCandidateSelectionReference[],
): Promise<MergedPersonProfileSelectionInput[]> {
  const rows = await friendRows(db, friendIds);
  const fields = new Set<string>();
  const resolved: MergedPersonProfileSelectionInput[] = [];
  for (const selection of selections) {
    if (fields.has(selection.fieldKey)) throw new Error('PROFILE_SELECTION_DUPLICATE');
    fields.add(selection.fieldKey);
    let selectedRow: FriendValueRow | null = null;
    let selectedValue: MergedPersonJsonValue | undefined;
    for (const row of rows) {
      const value = sourceValue(row, selection.fieldKey);
      if (value === undefined || value === null || value === '') continue;
      if (await profileCandidateId(selection.fieldKey, row.id, value) === selection.candidateId) {
        selectedRow = row;
        selectedValue = value;
        break;
      }
    }
    if (!selectedRow || selectedValue === undefined) throw new Error('PROFILE_CANDIDATE_STALE');
    resolved.push({
      fieldKey: selection.fieldKey,
      fieldLabel: FIELD_LABELS[selection.fieldKey]
        ?? selection.fieldKey.replace(/^metadata\./, ''),
      value: selectedValue,
      valuePreview: maskPreview(selectedValue),
      sourceType: selection.fieldKey.startsWith('metadata.') ? 'friend_field' : 'friend',
      sourceId: selectedRow.id,
      sourceLabel: selectedRow.display_name || '名前は未取得',
      sourceFriendId: selectedRow.id,
      verifiedAt: null,
      updateMode: selection.updateMode,
    });
  }
  return resolved;
}

export async function resolveFriendProfileSelections(
  db: D1Database,
  friendIds: string[],
  selections: SelectionReference[],
): Promise<MergedPersonProfileSelectionInput[]> {
  const rows = await friendRows(db, friendIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const fields = new Set<string>();
  return selections.map((selection) => {
    if (fields.has(selection.fieldKey)) throw new Error('PROFILE_SELECTION_DUPLICATE');
    fields.add(selection.fieldKey);
    const row = byId.get(selection.sourceFriendId);
    const value = row ? sourceValue(row, selection.fieldKey) : undefined;
    if (!row || value === undefined || value === null || value === '') {
      throw new Error('PROFILE_SELECTION_NOT_FOUND');
    }
    return {
      fieldKey: selection.fieldKey,
      fieldLabel: FIELD_LABELS[selection.fieldKey]
        ?? selection.fieldKey.replace(/^metadata\./, ''),
      value,
      valuePreview: maskPreview(value),
      sourceType: selection.fieldKey.startsWith('metadata.') ? 'friend_field' : 'friend',
      sourceId: selection.sourceFriendId,
      sourceLabel: row.display_name || '名前は未取得',
      sourceFriendId: selection.sourceFriendId,
      verifiedAt: null,
      updateMode: selection.updateMode,
    };
  });
}
