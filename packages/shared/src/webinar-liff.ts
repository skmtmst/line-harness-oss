export interface WebinarAudience {
  live: boolean;
  sessionStartAt: number | null;
  /** 直近 activeWindowSeconds 内に正常な再生通信があった人数。取得対象外は null。 */
  viewerCount: number | null;
  activeWindowSeconds: number;
  /** 講師名の保存先がない旧データは null。 */
  lecturerName: string | null;
}
