export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const LIST_CURSOR_MAX_LENGTH = 1024;

export type ListSortDirection = 'asc' | 'desc';
/** 並び順を公開していない既存一覧は、推測せず空配列で示す。 */
export type ListSort = ReadonlyArray<Readonly<{
  field: string;
  direction: ListSortDirection;
}>>;

export type ListPagingQuery = Readonly<Record<string, string | undefined>>;

export type ListPagingOptions = Readonly<{
  defaultLimit?: number;
  maxLimit?: number;
}>;

export type OffsetPaging = Readonly<{
  page: number;
  limit: number;
  offset: number;
}>;

export type CursorPaging = Readonly<{
  cursor?: string;
  limit: number;
}>;

export class ListPagingError extends Error {
  readonly status = 400;
  readonly code = 'cursor_invalid';
  readonly field = 'cursor';

  constructor(message = '続きの位置が正しくありません') {
    super(message);
    this.name = 'ListPagingError';
  }
}

/** 丸め方と入力エラーの判定は入口の契約に従い、数値指定の読み取りをそろえる。 */
export function listQueryNumber(
  raw: string | undefined,
  fallback: number | string,
  options: Readonly<{ format?: 'number' | 'integer-prefix' }> = {},
): number {
  const value = raw === undefined ? fallback : raw;
  return options.format === 'integer-prefix' ? Number.parseInt(String(value), 10) : Number(value);
}

function listInteger(raw: string | undefined, fallback: number): number {
  const parsed = listQueryNumber(raw, fallback);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

/** 不正な指定は既定値へ戻し、0以上の指定を上限内へ収める。 */
export function boundedListInteger(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = listQueryNumber(raw, Number.NaN);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

export function clampedListInteger(
  raw: string | undefined, fallback: number, minimum: number, maximum = Number.POSITIVE_INFINITY,
): number {
  const parsed = listQueryNumber(raw, Number.NaN);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function truncatedListLimit(raw: string | undefined, fallback: number, maximum: number): number {
  const parsed = listQueryNumber(raw, Number.NaN);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.trunc(parsed))) : fallback;
}

export function truncatedListOffset(raw: string | undefined): number {
  const parsed = listQueryNumber(raw, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

/** 不正な指定を拒否する入口へ、空欄の既定値と範囲内の整数を返す。 */
export function listIntegerInRange(
  raw: string | undefined, fallback: number, minimum: number, maximum: number,
): number | null {
  if (raw === undefined || raw === '') return fallback;
  const parsed = listQueryNumber(raw, Number.NaN);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function positiveInteger(raw: string | undefined, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = listInteger(raw, fallback);
  return parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

/** 一覧ごとの既定件数と上限を保ち、不正な指定は既定件数へ戻す。 */
export function listLimit(raw: string | undefined, fallback: number, maximum = MAX_LIST_LIMIT): number {
  return positiveInteger(raw, fallback, maximum);
}

/** 不正な開始位置は先頭へ戻す。 */
export function listOffset(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = listInteger(raw, 0);
  return parsed >= 0 ? parsed : 0;
}

export function listPage(raw: string | undefined): number {
  return positiveInteger(raw, 1);
}

function limits(options: ListPagingOptions): { defaultLimit: number; maxLimit: number } {
  const maxLimit = positiveInteger(String(options.maxLimit ?? MAX_LIST_LIMIT), MAX_LIST_LIMIT);
  const requestedDefault = positiveInteger(String(options.defaultLimit ?? DEFAULT_LIST_LIMIT), DEFAULT_LIST_LIMIT);
  return { defaultLimit: Math.min(requestedDefault, maxLimit), maxLimit };
}

function parseLimit(raw: string | undefined, options: ListPagingOptions): number {
  const { defaultLimit, maxLimit } = limits(options);
  return listLimit(raw, defaultLimit, maxLimit);
}

export function parseOffsetPaging(
  query: ListPagingQuery,
  options: ListPagingOptions = {},
): OffsetPaging {
  const page = listPage(query.page);
  const limit = parseLimit(query.limit, options);
  if (query.offset !== undefined) {
    const offset = listOffset(query.offset);
    return { page: Math.floor(offset / limit) + 1, limit, offset };
  }
  return { page, limit, offset: (page - 1) * limit };
}

export function parseCursorPaging(
  query: ListPagingQuery,
  options: ListPagingOptions = {},
): CursorPaging {
  const limit = parseLimit(query.limit, options);
  if (query.cursor === undefined || query.cursor === '') return { limit };

  const cursor = query.cursor;
  if (cursor.length > LIST_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9._~-]+$/.test(cursor)) {
    throw new ListPagingError();
  }
  return { cursor, limit };
}

export function offsetPageCount(total: number, limit: number): number {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeLimit = positiveInteger(String(limit), DEFAULT_LIST_LIMIT);
  return Math.max(1, Math.ceil(safeTotal / safeLimit));
}

/** 集計・別名・ページ位置など、既存の読み手が使う項目も残す。 */
export function buildOffsetListResponse<T, Details extends object = object>({
  items,
  total,
  paging,
  sort,
  ...details
}: {
  items: T[];
  total: number;
  paging: Pick<OffsetPaging, 'limit'>;
  sort: ListSort;
} & Details) {
  return { ...details, items, total, limit: paging.limit, sort };
}

type ListResponseCursor = string | null | Readonly<Record<string, string>>;

export function buildCursorListResponse<T, Details extends object = object, Cursor extends ListResponseCursor = string | null>({
  items,
  nextCursor,
  paging,
  sort,
  ...details
}: {
  items: T[];
  nextCursor?: Cursor;
  paging: CursorPaging;
  sort: ListSort;
} & Details) {
  const continuation: { nextCursor?: Cursor } = {};
  if (nextCursor || nextCursor === null) continuation.nextCursor = nextCursor;
  return {
    ...details,
    items,
    ...continuation,
    limit: paging.limit,
    sort,
  };
}
