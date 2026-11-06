/**
 * 「予約を入れる」ブロックの設定。
 *
 * メニューは1つに決める（複数メニューの同時受付はしない）。
 * 担当が空なら「だれでも」（予約側の自動割り当てに任せる）。
 * 選べる期間は今日から daysAhead 日後まで。空なら14日。
 * 予約は「未承認」で入り、店が承認する（すぐ確定は作らない）。
 */
export interface FormBookingConfig {
  routing?:import('./gap2.js').BookingRouting;
  kind?: 'people' | 'seats';
  storeId?: string;
  courseId?: string | null;
  menuId: string;
  staffId?: string | null;
  daysAhead?: number;
  /** 「メニューを選んでもらう」の保存値。未指定は既存の1メニュー固定。 */
  allowMenuSelection?: boolean;
  /** 「未承認で入れて店が承認する」の保存値。未指定は既存の受付設定を保つ。 */
  requireApproval?: boolean;
}

/**
 * 「予約を入れる」ブロックの回答の形。予約の確保は回答の送信後に
 * 予約の受け口で行い、枠の再確認と重なりの防止はそちらが担う。
 * ここでは「どの枠を選んだか」だけを持ち、形だけを検査する。
 */
export interface FormBookingValue {
  kind?: 'people' | 'seats';
  storeId?: string;
  courseId?: string | null;
  guestCount?: number;
  menuId: string;
  staffId: string;
  startsAt: string;
}
