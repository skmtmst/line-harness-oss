export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;
export const LIST_CURSOR_MAX_LENGTH = 1024;

export type ListSortDirection = 'asc' | 'desc';
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

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function limits(options: ListPagingOptions): { defaultLimit: number; maxLimit: number } {
  const maxLimit = positiveInteger(String(options.maxLimit ?? MAX_LIST_LIMIT), MAX_LIST_LIMIT);
  const requestedDefault = positiveInteger(String(options.defaultLimit ?? DEFAULT_LIST_LIMIT), DEFAULT_LIST_LIMIT);
  return { defaultLimit: Math.min(requestedDefault, maxLimit), maxLimit };
}

function parseLimit(raw: string | undefined, options: ListPagingOptions): number {
  const { defaultLimit, maxLimit } = limits(options);
  return Math.min(positiveInteger(raw, defaultLimit), maxLimit);
}

export function parseOffsetPaging(
  query: ListPagingQuery,
  options: ListPagingOptions = {},
): OffsetPaging {
  const page = positiveInteger(query.page, 1);
  const limit = parseLimit(query.limit, options);
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

export function buildOffsetListResponse<T>({
  items,
  total,
  paging,
  sort,
}: {
  items: T[];
  total: number;
  paging: OffsetPaging;
  sort: ListSort;
}) {
  return { items, total, limit: paging.limit, sort };
}

export function buildCursorListResponse<T>({
  items,
  nextCursor,
  paging,
  sort,
}: {
  items: T[];
  nextCursor?: string;
  paging: CursorPaging;
  sort: ListSort;
}) {
  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
    limit: paging.limit,
    sort,
  };
}
