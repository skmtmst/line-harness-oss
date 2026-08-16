/**
 * どのマイグレーションが実際に当たっているかを、現物のスキーマから判定する。
 *
 * なぜ要るか。`_migrations` は「当てた記録」を持つ表だが、
 * 検証・本番のどちらにもこの表が無い。スキーマは手で作られてきた。
 *
 * この状態で適用の仕組み（`_migrations` に無いものを当てる）を走らせると、
 * 001 から全件を流そうとして `ALTER TABLE ADD COLUMN` が
 * 「列がすでにある」で落ちる。だから先に、現物を見て記録を作る必要がある。
 *
 * 判定は「そのマイグレーションが持ち込む物が、いま在るか」で行う。
 * 目印は `bootstrap.sql`（最終形）に残っている物だけに絞る。
 * 027 や 029 のように「新しい表を作って旧を捨て、名前を付け替える」型は、
 * 途中の `*_new` が最終形に残らないので、この絞り込みで自動的に除ける。
 */

/** 表名 → 列名の集合。 */
export type TableColumns = Map<string, Set<string>>;

export interface Schema {
  tables: TableColumns;
  indexes: Set<string>;
}

export type MarkerKind = 'table' | 'column' | 'index';

export interface Marker {
  kind: MarkerKind;
  /** 表名、または索引名。 */
  name: string;
  /** kind が column のときの列名。 */
  column?: string;
}

export type MigrationState =
  | { state: 'applied' }
  | { state: 'missing' }
  /** 一部だけ在る。人が中を見るまで動かさない。 */
  | { state: 'partial'; missing: Marker[] }
  /** スキーマを変えないもの（データのみ）。現物からは判定できない。 */
  | { state: 'unknown' };

/**
 * `CREATE TABLE ...(...)` の本体を、最上位のカンマだけで分ける。
 *
 * 型や CHECK の中にも括弧とカンマが出るので、深さを数えないと
 * `DECIMAL(10, 2)` の途中で切れる。
 */
export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

const TABLE_CONSTRAINTS = new Set(['primary', 'unique', 'check', 'foreign', 'constraint']);

/**
 * `CREATE TABLE` 文から列名を取り出す。
 *
 * SQLite は `ALTER TABLE ADD COLUMN` で足した列を、括弧の内側の末尾に
 * 書き足す。だから最新の CREATE 文を読めば、後から足した列も込みで分かる。
 */
export function columnsOf(createSql: string): Set<string> {
  const open = createSql.indexOf('(');
  if (open < 0) return new Set();
  let depth = 0;
  let close = open;
  for (let i = open; i < createSql.length; i += 1) {
    if (createSql[i] === '(') depth += 1;
    else if (createSql[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const columns = new Set<string>();
  for (const part of splitTopLevel(createSql.slice(open + 1, close))) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const first = trimmed.split(/\s+/)[0].toLowerCase();
    if (TABLE_CONSTRAINTS.has(first)) continue;
    const match = /^["[`]?(\w+)["\]`]?/.exec(trimmed);
    if (match) columns.add(match[1]);
  }
  return columns;
}

export interface SqliteMasterRow {
  type: string;
  name: string;
  sql: string | null;
}

/** `SELECT type, name, sql FROM sqlite_master` の結果から現物の姿を作る。 */
export function schemaFromSqliteMaster(rows: SqliteMasterRow[]): Schema {
  const tables: TableColumns = new Map();
  const indexes = new Set<string>();
  for (const row of rows) {
    if (row.type === 'table') tables.set(row.name, columnsOf(row.sql ?? ''));
    else if (row.type === 'index') indexes.add(row.name);
  }
  return { tables, indexes };
}

const CREATE_TABLE = /CREATE TABLE(?: IF NOT EXISTS)?\s+["[`]?(\w+)/gi;
const ADD_COLUMN = /ALTER TABLE\s+["[`]?(\w+)["\]`]?\s+ADD COLUMN\s+["[`]?(\w+)/gi;
const CREATE_INDEX = /CREATE(?:\s+UNIQUE)?\s+INDEX(?: IF NOT EXISTS)?\s+["[`]?(\w+)/gi;

/**
 * マイグレーション1件の目印を作る。
 *
 * `final` は `bootstrap.sql` から作った最終形。ここに残らない物は、
 * 後の工程で捨てられる一時的なものなので目印にしない。
 */
export function markersOf(migrationSql: string, final: Schema): Marker[] {
  const markers: Marker[] = [];
  const seen = new Set<string>();
  const push = (marker: Marker) => {
    const key = `${marker.kind}:${marker.name}:${marker.column ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    markers.push(marker);
  };

  for (const m of migrationSql.matchAll(CREATE_TABLE)) {
    if (final.tables.has(m[1])) push({ kind: 'table', name: m[1] });
  }
  for (const m of migrationSql.matchAll(ADD_COLUMN)) {
    if (final.tables.get(m[1])?.has(m[2])) push({ kind: 'column', name: m[1], column: m[2] });
  }
  for (const m of migrationSql.matchAll(CREATE_INDEX)) {
    if (final.indexes.has(m[1])) push({ kind: 'index', name: m[1] });
  }
  return markers;
}

function present(marker: Marker, live: Schema): boolean {
  if (marker.kind === 'table') return live.tables.has(marker.name);
  if (marker.kind === 'index') return live.indexes.has(marker.name);
  return live.tables.get(marker.name)?.has(marker.column ?? '') ?? false;
}

/** 目印を現物と突き合わせて、当たっているかを決める。 */
export function judge(markers: Marker[], live: Schema): MigrationState {
  if (markers.length === 0) return { state: 'unknown' };
  const missing = markers.filter((marker) => !present(marker, live));
  if (missing.length === 0) return { state: 'applied' };
  if (missing.length === markers.length) return { state: 'missing' };
  return { state: 'partial', missing };
}

export function describeMarker(marker: Marker): string {
  if (marker.kind === 'column') return `列 ${marker.name}.${marker.column}`;
  if (marker.kind === 'index') return `索引 ${marker.name}`;
  return `表 ${marker.name}`;
}
