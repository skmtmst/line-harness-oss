/**
 * TikTok利益計算の自動化（第2段＝API連携）。
 *
 * 流れ（6時間ごとの重いレーンで1tick）:
 *   1. 利益計算用スプレッドシートが無ければ雛形から自動作成する
 *      （Googleの認可は #838 の google_sheets_integrations を使い回す）。
 *   2. EC-CUBE の読み取り専用エンドポイント `/line-harness/tiktok-order-export`
 *      から TikTok 注文明細を取り込み、D1 (tiktok_pnl_order_lines) へ upsert。
 *   3. 未反映（sheet_dirty=1）の行だけを「注文明細（自動）」タブへ upsert。
 *
 * 原価・報酬・手数料・送料・ランク判定などの計算はすべてシート側の数式で行う。
 * worker が書くのは A〜L 列の生データだけ（M列以降は数式なので触らない）。
 * 秘密値（トークン・署名鍵）は応答・ログに出さない。
 */
import type { Env } from '../index.js';
import {
  GoogleBusinessError,
  authorizedJson,
  type FetchLike,
  type RequestOptions,
} from './google-business.js';
import {
  sheetsAccessToken,
  type GoogleSheetsIntegrationRow,
} from './google-sheets.js';
import { createFeatureJobGate } from './feature-enforcement.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const EC_CALL_TIMEOUT_MS = 20 * 1000;
/** 1tickあたりのEC取り込みページ上限（1ページ最大200注文）。 */
const MAX_IMPORT_PAGES = 15;
const IMPORT_PAGE_LIMIT = 200;
/** 1tickあたりのシート書き出し行上限。初回の貯め込みも数tickで追いつく。 */
const MAX_SHEET_ROWS_PER_TICK = 2000;
/** 書き出し用バッチの大きさ（values:batchUpdate 1回分）。 */
const SHEET_BATCH_SIZE = 200;

export const TIKTOK_PNL_SPREADSHEET_TITLE = 'TikTok利益計算（自動集計）';

// タブ名。数式からも参照するため定数で一元管理する。
const TAB_GUIDE = '使い方';
const TAB_PNL = '月次PnL';
const TAB_RANK = 'ランク・枠管理';
const TAB_DETAIL = '注文明細（自動）';
const TAB_PRODUCT = '商品マスタ';
const TAB_COST = '原価マスタ';
const TAB_SETTINGS = '設定';

// ---------- 型 ----------

export interface TiktokPnlSettingsRow {
  line_account_id: string;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  status: 'pending' | 'ready' | 'error';
  import_cursor: string | null;
  last_import_at: string | null;
  last_sheet_sync_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

interface OrderLineRow {
  line_key: string;
  order_date_jst: string;
  tiktok_order_id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price_yen: number | null;
  line_amount_yen: number | null;
  order_status: string | null;
  buyer_key: string | null;
  paid_at: string | null;
  fetched_at: string;
}

/** EC-CUBE 側エクスポートの1明細行。 */
interface EcExportLine {
  index: number;
  sku?: string | null;
  product_name: string;
  quantity: number;
  unit_price_yen?: number | null;
  line_amount_yen?: number | null;
}

/** EC-CUBE 側エクスポートの1注文。 */
interface EcExportOrder {
  tiktok_order_id: string;
  ordered_at?: string | null;
  paid_at?: string | null;
  status?: string | null;
  buyer_key?: string | null;
  updated_at?: string | null;
  lines: EcExportLine[];
}

interface EcExportResponse {
  success?: boolean;
  orders?: EcExportOrder[];
  next_since?: string | null;
  has_more?: boolean;
  error?: string;
}

export interface TiktokPnlTickResult {
  createdSheets: number;
  importedOrders: number;
  wroteRows: number;
  skipped: number;
  failed: number;
}

// ---------- 日付ユーティリティ ----------

function jstDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function jstDateTimeOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function jstMonthOf(nowIso: string, offsetMonths: number): string {
  const base = new Date(Date.parse(nowIso) + 9 * 60 * 60 * 1000);
  const month = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offsetMonths, 1));
  return month.toISOString().slice(0, 7);
}

/** TikTokの注文ステータスを運用者向けの日本語へ寄せる。未知の値はそのまま。 */
function statusLabel(raw: string | null | undefined): string {
  const value = (raw ?? '').toUpperCase();
  if (!value) return '';
  if (value.includes('CANCEL')) return 'キャンセル';
  if (value === 'UNPAID') return '未払い';
  if (value === 'ON_HOLD') return '保留';
  if (value === 'AWAITING_SHIPMENT') return '発送待ち';
  if (value === 'AWAITING_COLLECTION') return '集荷待ち';
  if (value === 'IN_TRANSIT' || value === 'SHIPPED') return '配送中';
  if (value === 'DELIVERED') return '配達完了';
  if (value === 'COMPLETED') return '完了';
  return raw ?? '';
}

// ---------- EC-CUBE 取り込み ----------

/** photo-reward-sync.ts と同じ HMAC 署名（timestamp.body を sha256）。 */
async function signedEcPost<T>(
  client: { baseUrl: string; secret: string },
  path: string,
  payload: unknown,
  fetcher: FetchLike,
): Promise<{ status: number; body: T }> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(client.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const response = await fetcher(`${client.baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Nen-Timestamp': timestamp,
      'X-Nen-Signature': `sha256=${signature}`,
    },
    body,
    signal: AbortSignal.timeout(EC_CALL_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => ({})) as T;
  return { status: response.status, body: json };
}

/**
 * EC-CUBE から更新分の注文を取り込み、D1 へ upsert する。
 * シートに見える値が変わった行だけ sheet_dirty=1 に戻す。
 */
async function importFromEc(
  db: D1Database,
  ec: { baseUrl: string; secret: string },
  lineAccountId: string,
  settings: TiktokPnlSettingsRow,
  nowIso: string,
  fetcher: FetchLike,
): Promise<{ orders: number; cursor: string | null }> {
  let cursor = settings.import_cursor;
  let imported = 0;
  for (let page = 0; page < MAX_IMPORT_PAGES; page += 1) {
    const { status, body } = await signedEcPost<EcExportResponse>(
      ec, '/line-harness/tiktok-order-export', { since: cursor, limit: IMPORT_PAGE_LIMIT }, fetcher,
    );
    if (status === 404) {
      // EC側のエンドポイントが未配備。シート作成だけ先行できるよう、致命扱いにしない。
      throw new TiktokPnlError('ec_endpoint_missing');
    }
    if (status === 401 || status === 403) throw new TiktokPnlError('ec_auth_failed');
    if (status !== 200 || body.success === false) throw new TiktokPnlError('ec_fetch_failed');
    const orders = body.orders ?? [];
    for (const order of orders) {
      await upsertOrder(db, lineAccountId, order, nowIso);
      imported += 1;
    }
    cursor = body.next_since ?? cursor;
    if (!body.has_more || orders.length === 0) break;
  }
  return { orders: imported, cursor };
}

async function upsertOrder(
  db: D1Database,
  lineAccountId: string,
  order: EcExportOrder,
  nowIso: string,
): Promise<void> {
  const orderDate = jstDateOf(order.paid_at) ?? jstDateOf(order.ordered_at) ?? jstDateOf(order.updated_at);
  if (!orderDate || !order.tiktok_order_id) return;
  for (const line of order.lines ?? []) {
    const quantity = Number(line.quantity);
    if (!line.product_name || !Number.isFinite(quantity)) continue;
    const lineKey = `${order.tiktok_order_id}:${line.index}`;
    await db.prepare(
      `INSERT INTO tiktok_pnl_order_lines (
         line_key, line_account_id, tiktok_order_id, line_index, order_date_jst,
         paid_at, order_status, sku, product_name, quantity,
         unit_price_yen, line_amount_yen, buyer_key, source_updated_at, fetched_at,
         sheet_dirty, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(line_account_id, line_key) DO UPDATE SET
         order_date_jst = excluded.order_date_jst,
         paid_at = excluded.paid_at,
         order_status = excluded.order_status,
         sku = excluded.sku,
         product_name = excluded.product_name,
         quantity = excluded.quantity,
         unit_price_yen = excluded.unit_price_yen,
         line_amount_yen = excluded.line_amount_yen,
         buyer_key = excluded.buyer_key,
         source_updated_at = excluded.source_updated_at,
         fetched_at = excluded.fetched_at,
         updated_at = excluded.updated_at,
         sheet_dirty = CASE WHEN
             tiktok_pnl_order_lines.order_date_jst IS NOT excluded.order_date_jst
             OR tiktok_pnl_order_lines.order_status IS NOT excluded.order_status
             OR tiktok_pnl_order_lines.product_name IS NOT excluded.product_name
             OR tiktok_pnl_order_lines.quantity IS NOT excluded.quantity
             OR tiktok_pnl_order_lines.unit_price_yen IS NOT excluded.unit_price_yen
             OR tiktok_pnl_order_lines.line_amount_yen IS NOT excluded.line_amount_yen
             OR tiktok_pnl_order_lines.buyer_key IS NOT excluded.buyer_key
             OR tiktok_pnl_order_lines.paid_at IS NOT excluded.paid_at
           THEN 1 ELSE tiktok_pnl_order_lines.sheet_dirty END`,
    ).bind(
      lineKey, lineAccountId, order.tiktok_order_id, line.index, orderDate,
      order.paid_at ?? null, order.status ?? null, line.sku ?? null, line.product_name, quantity,
      line.unit_price_yen ?? null, line.line_amount_yen ?? null, order.buyer_key ?? null,
      order.updated_at ?? null, nowIso, nowIso, nowIso,
    ).run();
  }
}

// ---------- スプレッドシート雛形 ----------

function q(tab: string): string {
  return `'${tab}'`;
}

/** 明細タブの数式列（M〜Y、1行目に見出しごと入れて下へ自動展開）。 */
function detailFormulaHeader(): string[] {
  const D = q(TAB_DETAIL);
  const P = q(TAB_PRODUCT);
  const S = q(TAB_SETTINGS);
  void D;
  return [
    `={"商品名キー";ARRAYFORMULA(IF($A$2:$A="",,TRIM(SUBSTITUTE(SUBSTITUTE($D$2:$D,"*",""),"＊",""))))}`,
    `={"＊商品";ARRAYFORMULA(IF($A$2:$A="",,IF((LEFT(TRIM($D$2:$D),1)="*")+(LEFT(TRIM($D$2:$D),1)="＊")>0,"はい","いいえ")))}`,
    `={"月";ARRAYFORMULA(IF($A$2:$A="",,LEFT($B$2:$B,7)))}`,
    `={"点数";ARRAYFORMULA(IF($A$2:$A="",,IFERROR(VLOOKUP($M$2:$M,${P}!$A$2:$I,8,FALSE)*$F$2:$F,0)))}`,
    `={"商品原価";ARRAYFORMULA(IF($A$2:$A="",,IFERROR(VLOOKUP($M$2:$M,${P}!$A$2:$I,9,FALSE)*$F$2:$F,0)))}`,
    `={"報酬率";ARRAYFORMULA(IF($A$2:$A="",,IF($N$2:$N="はい",${S}!$B$5,${S}!$B$6)))}`,
    `={"アフィリ報酬";ARRAYFORMULA(IF($A$2:$A="",,ROUND($H$2:$H*$R$2:$R,0)))}`,
    `={"TikTok手数料";ARRAYFORMULA(IF($A$2:$A="",,ROUND($H$2:$H*${S}!$B$4,0)))}`,
    `={"粗利(送料前)";ARRAYFORMULA(IF($A$2:$A="",,$H$2:$H-$Q$2:$Q-$S$2:$S-$T$2:$T))}`,
    `={"発送キー";ARRAYFORMULA(IF($A$2:$A="",,$B$2:$B&"|"&$J$2:$J))}`,
    `={"商品登録";ARRAYFORMULA(IF($A$2:$A="",,IF(ISNA(MATCH($M$2:$M,${P}!$A$2:$A,0)),"⚠️未登録","OK")))}`,
    `={"集計対象";ARRAYFORMULA(IF($A$2:$A="",,IF((($I$2:$I="キャンセル")+($Y$2:$Y<>""))>0,0,1)))}`,
    '手動除外（除外したい行に×を入力）',
  ];
}

function monthlyPnlRows(nowIso: string): (string | number)[][] {
  const D = q(TAB_DETAIL);
  const S = q(TAB_SETTINGS);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < 24; i += 1) {
    const row = i + 2;
    rows.push([
      jstMonthOf(nowIso, i - 1),
      `=IF($A${row}="","",SUMIFS(${D}!$H$2:$H,${D}!$O$2:$O,$A${row},${D}!$X$2:$X,1))`,
      `=IF($A${row}="","",SUMIFS(${D}!$Q$2:$Q,${D}!$O$2:$O,$A${row},${D}!$X$2:$X,1))`,
      `=IF($A${row}="","",SUMIFS(${D}!$S$2:$S,${D}!$O$2:$O,$A${row},${D}!$X$2:$X,1))`,
      `=IF($A${row}="","",SUMIFS(${D}!$T$2:$T,${D}!$O$2:$O,$A${row},${D}!$X$2:$X,1))`,
      `=IF($A${row}="","",IFERROR(COUNTUNIQUE(FILTER(${D}!$V$2:$V,${D}!$O$2:$O=$A${row},${D}!$X$2:$X=1)),0))`,
      `=IF($A${row}="","",$F${row}*${S}!$B$2)`,
      `=IF($A${row}="","",$F${row}*${S}!$B$3)`,
      '',
      '',
      `=IF($A${row}="","",$B${row}-$C${row}-$D${row}-$E${row}-$G${row}-$H${row}-N($J${row})+N($I${row}))`,
      `=IF(OR($A${row}="",N($B${row})=0),"",$K${row}/$B${row})`,
    ]);
  }
  return rows;
}

function productMasterRows(): (string | number)[][] {
  // 既存シート「出品マスター」の11商品を初期値として登録する。
  // 商品名キーは＊を除いた名前。TikTok側の商品名と一致しないときは
  // 明細の「商品登録」列が⚠️未登録になるので、A列を実際の名前へ直す。
  const seeds: [string, number, number, number, number, number][] = [
    ['人気3種お楽しみセット (ミンチ/ジャーキー/骨)', 5980, 1, 1, 1, 0],
    ['毎日の鹿肉バランス4袋セット (ミンチ2/ジャーキー2)', 6980, 2, 2, 0, 0],
    ['ボーンブロス3点セット (ミンチ/ジャーキー/ブロス)', 5480, 1, 1, 0, 1],
    ['無添加カリカリ鹿肉ミンチ 単品 (1袋)', 2480, 1, 0, 0, 0],
    ['無添加手ちぎり鹿肉ジャーキー 単品 (1袋)', 2580, 0, 1, 0, 0],
    ['濃厚鹿骨ボーンブロススープ 単品 (1袋)', 2380, 0, 0, 0, 1],
    ['カリカリミンチ お得用2袋セット', 4280, 2, 0, 0, 0],
    ['手ちぎりジャーキー お得用2袋セット', 4480, 0, 2, 0, 0],
    ['ミンチ＆ジャーキー お試し2点セット', 3900, 1, 1, 0, 0],
    ['ボーンブロス＆ミンチ 水分補給2点セット', 4180, 1, 0, 0, 1],
    ['鹿肉ミンチ＆ジャーキー3袋セット（ミンチ2/ジャーキー1）', 5680, 2, 1, 0, 0],
  ];
  const C = q(TAB_COST);
  const rows: (string | number)[][] = [];
  for (let i = 0; i < 40; i += 1) {
    const row = i + 2;
    const seed = seeds[i];
    rows.push([
      seed ? seed[0] : '',
      '',
      seed ? seed[1] : '',
      seed ? seed[2] : '',
      seed ? seed[3] : '',
      seed ? seed[4] : '',
      seed ? seed[5] : '',
      `=IF($A${row}="","",N($D${row})+N($E${row})+N($F${row})+N($G${row}))`,
      `=IF($A${row}="","",N($D${row})*${C}!$B$2+N($E${row})*${C}!$B$3+N($F${row})*${C}!$B$4+N($G${row})*${C}!$B$5)`,
    ]);
  }
  return rows;
}

function rankRows(): (string | number)[][] {
  const D = q(TAB_DETAIL);
  const S = q(TAB_SETTINGS);
  return [
    ['【非＊商品のランク管理（累計）】', ''],
    ['非＊商品の累計点数', `=SUMIFS(${D}!$P$2:$P,${D}!$N$2:$N,"いいえ",${D}!$X$2:$X,1)`],
    ['実績上の到達報酬率', `=VLOOKUP($B$2,${S}!$A$11:$C$13,2,TRUE)`],
    ['到達ランク', `=VLOOKUP($B$2,${S}!$A$11:$C$13,3,TRUE)`],
    ['TikTok側に設定中の率', `=${S}!$B$6`],
    ['判定', `=IF($B$3>$B$5,"⚠️ TikTok側の報酬率を "&TEXT($B$3,"0%")&" へ引き上げてください","OK：今の設定のままで大丈夫です")`],
    ['次のランクまであと', `=IFERROR(INDEX(${S}!$A$11:$A$13,MATCH($B$2,${S}!$A$11:$A$13,1)+1)-$B$2&" 点","最高ランク到達済み")`],
    ['', ''],
    ['【＊商品（80%枠）の管理（当月）】', ''],
    ['当月の＊商品点数', `=SUMIFS(${D}!$P$2:$P,${D}!$N$2:$N,"はい",${D}!$O$2:$O,TEXT(TODAY(),"YYYY-MM"),${D}!$X$2:$X,1)`],
    ['80%枠の月間上限', `=${S}!$B$7`],
    ['残り枠', '=$B$11-$B$10'],
    ['判定', `=IF($B$12<0,"⚠️ 上限を超えています。＊商品の在庫で調整してください",IF($B$12<=10,"もうすぐ上限です（残り "&$B$12&" 点）","OK"))`],
    ['', ''],
    ['【商品マスタの登録チェック】', ''],
    ['未登録の明細行数', `=COUNTIF(${D}!$W$2:$W,"⚠️未登録")`],
    ['対応', `=IF($B$16>0,"⚠️ 注文明細の「商品登録」列が⚠️未登録の商品名を、商品マスタのA列へ追加してください","OK：すべての商品がマスタに登録されています")`],
  ];
}

function guideRows(): string[][] {
  return [
    ['【このスプレッドシートについて】'],
    ['TikTok Shopの注文がEC-CUBE経由で「注文明細（自動）」タブへ6時間ごとに自動で入り、売上・原価・報酬・手数料・送料を引いた利益を自動計算します。'],
    [''],
    ['■ 自動で更新されるタブ（編集しないでください）'],
    ['・注文明細（自動）… A〜L列は自動入力。M列以降は数式です。手で直すのはY列「手動除外」だけ。'],
    [''],
    ['■ あなたが編集するタブ'],
    ['・設定 … 送料・ダンボール代・手数料率・報酬率・80%枠の上限。TikTok側で報酬率を変えたら「設定」B6も更新してください。'],
    ['・原価マスタ … 1袋あたりの製造原価（包装費込み）。仕入が変わったらここを変更。'],
    ['・商品マスタ … セットの内訳（何袋入りか）。＊は付けない名前で登録します。'],
    [''],
    ['■ 毎回見るタブ'],
    ['・月次PnL … 月ごとの利益。返品などはI列「調整額」、広告費はJ列に手で入力。'],
    ['・ランク・枠管理 … 非＊商品の累計点数と、TikTok側の報酬率を上げるタイミング、80%枠の残りを表示。⚠️が出たら対応してください。'],
    [''],
    ['■ 商品名が「⚠️未登録」になったら'],
    ['注文明細の「商品名キー」列（M列）の名前をコピーして、商品マスタのA列に行を追加し、袋数を入れてください。'],
    [''],
    ['■ キャンセル・返品'],
    ['キャンセルは自動で集計から外れます。返品などで手動調整したい場合は、注文明細のY列に×を入れるか、月次PnLの調整額に金額を入れてください。'],
  ];
}

/** 雛形スプレッドシートを作成し、そのIDを返す。 */
async function createTemplateSpreadsheet(
  options: RequestOptions,
  nowIso: string,
): Promise<{ spreadsheetId: string; url: string }> {
  const created = await authorizedJson<{ spreadsheetId?: string; spreadsheetUrl?: string }>(
    options,
    SHEETS_API,
    {
      method: 'POST',
      // 作成の再試行は同名シートの二重作成になり得るが、成功応答を取りこぼした
      // 場合のみで、次tickの設定行チェックで気付ける。retry既定のままにする。
      body: {
        properties: { title: TIKTOK_PNL_SPREADSHEET_TITLE, locale: 'ja_JP', timeZone: 'Asia/Tokyo' },
        sheets: [
          { properties: { title: TAB_GUIDE } },
          { properties: { title: TAB_PNL, gridProperties: { frozenRowCount: 1 } } },
          { properties: { title: TAB_RANK } },
          { properties: { title: TAB_DETAIL, gridProperties: { frozenRowCount: 1 } } },
          { properties: { title: TAB_PRODUCT, gridProperties: { frozenRowCount: 1 } } },
          { properties: { title: TAB_COST, gridProperties: { frozenRowCount: 1 } } },
          { properties: { title: TAB_SETTINGS } },
        ],
      },
    },
  );
  const spreadsheetId = created.spreadsheetId;
  if (!spreadsheetId) throw new TiktokPnlError('sheet_create_failed');

  const enc = encodeURIComponent;
  const data: { range: string; values: (string | number)[][] }[] = [
    { range: `'${TAB_GUIDE}'!A1`, values: guideRows() },
    {
      range: `'${TAB_SETTINGS}'!A1`,
      values: [
        ['項目', '値', '説明'],
        ['送料（1発送あたり・円）', 1100, 'クール便の実費に合わせて変更できます'],
        ['ダンボール・資材費（1発送あたり・円）', 30, ''],
        ['TikTok手数料率', 0.07, '7%なら 0.07 と入力'],
        ['＊商品の報酬率', 0.8, '＊付き商品は点数に関係なく常にこの率'],
        ['非＊商品でTikTok側に設定中の報酬率', 0.2, 'TikTok側で率を上げたらここも更新'],
        ['80%枠の月間上限（点）', 102, '＊商品の在庫で調整する枠。変えたらここを更新'],
        ['', '', ''],
        ['【非＊商品のランク表（累計点数で判定）】', '', ''],
        ['累計点数（下限）', '報酬率', 'ランク名'],
        [0, 0.2, 'スタート'],
        [101, 0.22, 'シルバー'],
        [667, 0.25, 'VIPゴールド'],
      ],
    },
    {
      range: `'${TAB_COST}'!A1`,
      values: [
        ['材料', '1袋あたり原価（円）', '説明'],
        ['ミンチ', 424, '包装費込み。仕入が変わったらここを変更'],
        ['ジャーキー', 473, ''],
        ['骨（アバラ骨）', 594, ''],
        ['ボーンブロス', 300, ''],
      ],
    },
    {
      range: `'${TAB_PRODUCT}'!A1`,
      values: [
        ['商品名キー（＊を除いた商品名）', 'SKU（メモ）', '販売価格（参考）', 'ミンチ', 'ジャーキー', '骨', 'ブロス', '点数', '原価（円）'],
        ...productMasterRows(),
      ],
    },
    {
      range: `'${TAB_DETAIL}'!A1`,
      values: [[
        '明細キー', '注文日', '注文番号', '商品名', 'SKU', '数量', '販売単価', '売上金額',
        '状態', '購入者', '支払日時', '取込日時',
        ...detailFormulaHeader(),
      ]],
    },
    {
      range: `'${TAB_PNL}'!A1`,
      values: [
        ['月', '売上', '商品原価', 'アフィリ報酬', 'TikTok手数料', '発送件数', '送料', '資材費',
          '調整額（手動：返品等はマイナス）', '広告費（手動）', '営業利益', '利益率'],
        ...monthlyPnlRows(nowIso),
      ],
    },
    { range: `'${TAB_RANK}'!A1`, values: rankRows() },
  ];
  await authorizedJson(
    options,
    `${SHEETS_API}/${enc(spreadsheetId)}/values:batchUpdate`,
    { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data } },
  );
  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}

// ---------- 明細タブへの書き出し ----------

function detailRowValues(row: OrderLineRow): (string | number)[] {
  return [
    row.line_key,
    row.order_date_jst,
    row.tiktok_order_id,
    row.product_name,
    row.sku ?? '',
    row.quantity,
    row.unit_price_yen ?? '',
    row.line_amount_yen ?? '',
    statusLabel(row.order_status),
    row.buyer_key ?? '',
    jstDateTimeOf(row.paid_at) ?? '',
    jstDateTimeOf(row.fetched_at) ?? '',
  ];
}

async function writeDirtyRows(
  db: D1Database,
  options: RequestOptions,
  spreadsheetId: string,
  lineAccountId: string,
): Promise<number> {
  const dirty = await db.prepare(
    `SELECT line_key, order_date_jst, tiktok_order_id, product_name, sku, quantity,
            unit_price_yen, line_amount_yen, order_status, buyer_key, paid_at, fetched_at
       FROM tiktok_pnl_order_lines
      WHERE line_account_id = ? AND sheet_dirty = 1
      ORDER BY order_date_jst, line_key
      LIMIT ?`,
  ).bind(lineAccountId, MAX_SHEET_ROWS_PER_TICK).all<OrderLineRow>();
  const rows = dirty.results;
  if (rows.length === 0) return 0;

  const enc = encodeURIComponent;
  // 既存行の位置をキー列（A列）から読む。行番号は2始まり。
  const keyRes = await authorizedJson<{ values?: string[][] }>(
    options,
    `${SHEETS_API}/${enc(spreadsheetId)}/values/${enc(`'${TAB_DETAIL}'!A2:A`)}?majorDimension=COLUMNS`,
  );
  const keyToRow = new Map<string, number>();
  const column = keyRes.values?.[0] ?? [];
  column.forEach((value, index) => {
    if (value) keyToRow.set(value, index + 2);
  });

  let written = 0;
  for (let offset = 0; offset < rows.length; offset += SHEET_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + SHEET_BATCH_SIZE);
    const updates: { range: string; values: (string | number)[][] }[] = [];
    const appends: (string | number)[][] = [];
    for (const row of batch) {
      const existing = keyToRow.get(row.line_key);
      if (existing) {
        updates.push({ range: `'${TAB_DETAIL}'!A${existing}:L${existing}`, values: [detailRowValues(row)] });
      } else {
        appends.push(detailRowValues(row));
      }
    }
    if (updates.length > 0) {
      await authorizedJson(
        options,
        `${SHEETS_API}/${enc(spreadsheetId)}/values:batchUpdate`,
        { method: 'POST', body: { valueInputOption: 'RAW', data: updates } },
      );
    }
    if (appends.length > 0) {
      await authorizedJson(
        options,
        `${SHEETS_API}/${enc(spreadsheetId)}/values/${enc(`'${TAB_DETAIL}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: 'POST', body: { values: appends } },
      );
      // 追記した行の位置は次tickのキー列読み直しで解決する。同一tick内の
      // 重複追記は line_key 単位のバッチ分割なので起きない。
    }
    // 書けた分だけ dirty を落とす（途中失敗なら残りは次tickで再送）。
    for (let i = 0; i < batch.length; i += 80) {
      const keys = batch.slice(i, i + 80).map((r) => r.line_key);
      // line_key はアカウント間で重複し得るため、必ず line_account_id で絞る。
      // 絞らないと他アカウントの未反映フラグを消し、そのシートへ永久に書けなくなる。
      await db.prepare(
        `UPDATE tiktok_pnl_order_lines SET sheet_dirty = 0, updated_at = datetime('now')
          WHERE line_account_id = ? AND line_key IN (${keys.map(() => '?').join(',')})`,
      ).bind(lineAccountId, ...keys).run();
    }
    written += batch.length;
  }
  return written;
}

// ---------- 本体 ----------

class TiktokPnlError extends Error {
  constructor(public kind: string) {
    super(kind);
    this.name = 'TiktokPnlError';
  }
}

async function loadSettings(db: D1Database, lineAccountId: string): Promise<TiktokPnlSettingsRow> {
  const existing = await db.prepare(
    'SELECT * FROM tiktok_pnl_settings WHERE line_account_id = ?',
  ).bind(lineAccountId).first<TiktokPnlSettingsRow>();
  if (existing) return existing;
  await db.prepare(
    `INSERT INTO tiktok_pnl_settings (line_account_id) VALUES (?)
     ON CONFLICT(line_account_id) DO NOTHING`,
  ).bind(lineAccountId).run();
  const created = await db.prepare(
    'SELECT * FROM tiktok_pnl_settings WHERE line_account_id = ?',
  ).bind(lineAccountId).first<TiktokPnlSettingsRow>();
  if (!created) throw new TiktokPnlError('settings_missing');
  return created;
}

async function saveSettings(
  db: D1Database,
  lineAccountId: string,
  patch: Partial<Pick<TiktokPnlSettingsRow,
    'spreadsheet_id' | 'spreadsheet_url' | 'status' | 'import_cursor'
    | 'last_import_at' | 'last_sheet_sync_at' | 'last_error' | 'consecutive_failures'>>,
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    binds.push(value);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = datetime('now')`);
  binds.push(lineAccountId);
  await db.prepare(
    `UPDATE tiktok_pnl_settings SET ${sets.join(', ')} WHERE line_account_id = ?`,
  ).bind(...binds).run();
}

export interface TiktokPnlAccountResult {
  status: 'ok' | 'partial' | 'error' | 'skipped';
  createdSheet: boolean;
  importedOrders: number;
  wroteRows: number;
  error?: string;
  spreadsheetUrl?: string | null;
}

/**
 * 1アカウント分の同期。シート作成 → EC取り込み → 明細書き出しの順で、
 * 途中で失敗しても進んだ分は保存し、次tickで続きから再開できるようにする。
 */
export async function syncTiktokPnlForAccount(
  env: Env['Bindings'],
  integration: GoogleSheetsIntegrationRow,
  input: { now: string; fetch?: FetchLike },
): Promise<TiktokPnlAccountResult> {
  const db = env.DB;
  const fetchFn: FetchLike = input.fetch ?? ((url, init) => fetch(url, init));
  const lineAccountId = integration.line_account_id;
  const settings = await loadSettings(db, lineAccountId);

  let createdSheet = false;
  let importedOrders = 0;
  let wroteRows = 0;
  try {
    const accessToken = await sheetsAccessToken(env, integration, fetchFn);
    const options: RequestOptions = { fetch: fetchFn, accessToken };

    let spreadsheetId = settings.spreadsheet_id;
    if (!spreadsheetId) {
      const created = await createTemplateSpreadsheet(options, input.now);
      spreadsheetId = created.spreadsheetId;
      createdSheet = true;
      await saveSettings(db, lineAccountId, {
        spreadsheet_id: created.spreadsheetId,
        spreadsheet_url: created.url,
        status: 'ready',
        last_error: null,
      });
    }

    // EC側の接続設定が無い環境（手元など）では取り込みを飛ばし、
    // シート作成と書き出しだけ行う。
    let importSkipReason: string | null = null;
    if (env.NEN_EC_BASE_URL && env.ECCUBE_WEBHOOK_SECRET) {
      try {
        const result = await importFromEc(
          db,
          { baseUrl: env.NEN_EC_BASE_URL, secret: env.ECCUBE_WEBHOOK_SECRET },
          lineAccountId,
          { ...settings, spreadsheet_id: spreadsheetId },
          input.now,
          fetchFn,
        );
        importedOrders = result.orders;
        await saveSettings(db, lineAccountId, {
          import_cursor: result.cursor,
          last_import_at: input.now,
        });
      } catch (error) {
        // 取り込み失敗でも、既に取り込んだ分のシート反映は続ける。
        importSkipReason = error instanceof TiktokPnlError ? error.kind : 'ec_fetch_failed';
      }
    } else {
      importSkipReason = 'ec_not_configured';
    }

    wroteRows = await writeDirtyRows(db, options, spreadsheetId, lineAccountId);
    await saveSettings(db, lineAccountId, {
      status: importSkipReason && importSkipReason !== 'ec_not_configured' ? 'error' : 'ready',
      last_sheet_sync_at: input.now,
      last_error: importSkipReason,
      consecutive_failures: importSkipReason && importSkipReason !== 'ec_not_configured'
        ? settings.consecutive_failures + 1 : 0,
    });
    return {
      status: importSkipReason && importSkipReason !== 'ec_not_configured' ? 'partial' : 'ok',
      createdSheet,
      importedOrders,
      wroteRows,
      error: importSkipReason ?? undefined,
      spreadsheetUrl: settings.spreadsheet_url
        ?? (spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : null),
    };
  } catch (error) {
    const kind = error instanceof GoogleBusinessError
      ? error.kind
      : error instanceof TiktokPnlError ? error.kind : 'unknown';
    await saveSettings(db, lineAccountId, {
      status: 'error',
      last_error: kind,
      consecutive_failures: settings.consecutive_failures + 1,
    });
    return { status: 'error', createdSheet, importedOrders, wroteRows, error: kind };
  }
}

/**
 * 6時間ごとの定期実行。Google Sheets 連携済み（#838）のアカウントを対象に、
 * 機能ゲート（external_integrations）を通ったものだけ同期する。
 */
export async function processTiktokPnlTick(
  env: Env['Bindings'],
  input: { now: string; fetch?: FetchLike },
): Promise<TiktokPnlTickResult> {
  const db = env.DB;
  const gate = createFeatureJobGate();
  const integrations = await db.prepare(
    `SELECT * FROM google_sheets_integrations
      WHERE status = 'connected'
      ORDER BY line_account_id`,
  ).all<GoogleSheetsIntegrationRow>();

  const result: TiktokPnlTickResult = {
    createdSheets: 0, importedOrders: 0, wroteRows: 0, skipped: 0, failed: 0,
  };
  for (const integration of integrations.results) {
    try {
      if (!await gate.canRun(db, integration.line_account_id, 'external_integrations', 'tiktok pnl sync')) {
        result.skipped += 1;
        continue;
      }
      const one = await syncTiktokPnlForAccount(env, integration, input);
      if (one.createdSheet) result.createdSheets += 1;
      result.importedOrders += one.importedOrders;
      result.wroteRows += one.wroteRows;
      if (one.status === 'error') result.failed += 1;
    } catch (error) {
      result.failed += 1;
      console.error(JSON.stringify({
        event: 'tiktok_pnl_sync_failed',
        lineAccountId: integration.line_account_id,
        error: error instanceof GoogleBusinessError ? error.kind
          : error instanceof Error ? error.name : 'unknown',
      }));
    }
  }
  return result;
}
