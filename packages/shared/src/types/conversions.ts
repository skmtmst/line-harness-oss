// -----------------------------------------------------------------------------
// コンバージョンポイント (ConversionPoint) — CV計測
// -----------------------------------------------------------------------------

/** 成果をどうやって数えるか */
export type ConversionMeasureMethod = "url_reach" | "webhook" | "manual";

export interface ConversionPoint {
  /** 主キー (UUIDv4) */
  id: string;
  /** CV名 */
  name: string;
  /** CV種別 */
  eventType: string;
  /** 金額 (任意) */
  value: number | null;
  /** どうやって数えるか。既定は manual（人が記録する） */
  measureMethod?: ConversionMeasureMethod;
  /** url_reach のときの対象URL。前方一致で判定する */
  targetUrl?: string | null;
  /** 同じ人を何度でも数えるか。false なら一人一回 */
  countRepeat?: boolean;
  /** 成果を紐づける日数。null なら全体の既定（90日） */
  attributionDays?: number | null;
  /** 集計対象を1アカウントに絞る場合。null なら全アカウント */
  lineAccountId?: string | null;
  /** 楽観ロック版。更新・停止にはこの版の一致が要る */
  version: number;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

// -----------------------------------------------------------------------------
// コンバージョンイベント (ConversionEvent) — CV記録
// -----------------------------------------------------------------------------

export interface ConversionEvent {
  /** 主キー (UUIDv4) */
  id: string;
  /** コンバージョンポイントID */
  conversionPointId: string;
  /** 友だちID */
  friendId: string;
  /** 内部ユーザーUUID */
  userId: string | null;
  /** アフィリエイトコード */
  affiliateCode: string | null;
  /** メタデータ (JSON) */
  metadata: string | null;
  /** 作成日時 (ISO 8601) */
  createdAt: string;
}

export interface AdEventMapping {
  pointId: string;
  pointName: string;
  eventType: string;
  provider: 'meta' | 'google';
  mode: 'auto' | 'manual' | 'off';
  eventName: string | null;
  automaticEventName: string | null;
  googleActionId: string | null;
  version: number;
}

export interface SaveAdEventMappingRequest {
  account_id: string;
  provider: 'meta' | 'google';
  mode: 'auto' | 'manual' | 'off';
  eventName?: string | null;
  googleActionId?: string | null;
  expectedVersion: number;
}

/** サイトごとの同意済み最終受信。まだ受け取っていなければnull。 */
export interface MeasurementSiteReceipt { lastReceivedAt: string | null }

export interface AdConversionCostSummary {
  from: string; to: string;
  confirmedConversionCount: number;
  costPerConversionMinor: number | null;
  currency: 'JPY' | null;
}

export interface AdPlatformConnectResult { id: string; connected: true; verifiedAt: string }
