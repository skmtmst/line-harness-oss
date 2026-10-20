/**
 * fetch-jp-postal-data.mjs の型宣言（実行は .mjs が正本）。
 *
 * scripts の試験（.ts）から .mjs の実exportを型つきで読むための宣言。
 * 形は .mjs の実装と一致させる。新しいexportを足したらここへ足す。
 */

export interface PostalCsvRow {
  code: string;
  prefecture: string;
  city: string;
  town: string;
}

export interface PostalCsvParseResult {
  rows: PostalCsvRow[];
  skipped: number;
}

export interface PostalImportBatchEntry {
  row: PostalCsvRow;
  text: string;
}

export interface BuildImportSqlArgs {
  rows: PostalCsvRow[];
  sourceUrl: string;
  inputSha256: string;
  inputBytes: number;
  manifestId: string;
  importedAt: string;
}

export function splitCsvLine(line: string): string[];
export function normalizeCode(raw: unknown): string | null;
export function parsePostalCsv(text: string): PostalCsvParseResult;
export const IMPORT_SQL_MAX_STATEMENT_BYTES: number;
export function splitImportBatches(
  rows: PostalCsvRow[],
  sourceUrl: string,
  importedAt: string,
  maxBytes?: number,
): PostalImportBatchEntry[][];
export const IMPORT_SENTINEL_ROW_COUNT: number;
export function buildImportSql(args: BuildImportSqlArgs): string;
