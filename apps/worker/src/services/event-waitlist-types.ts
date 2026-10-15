export interface EventOccurrenceApplicants {
  occurrence: {
    id: string;
    eventId: string;
    startsAt: string;
    endsAt: string;
    capacity: number | null;
    activeSeats: number;
    version: number;
  };
  summary: {
    bookingCount: number;
    waitingCount: number;
    activeSeats: number;
    /*
     * IDEA-29: 状態ごとの人数(party_size 合計)。行数だけだと複数人申込で
     * 定員の残りと食い違うため、席を消費する単位で分けて返す。
     * 待機中は席を消費しない。案内中・受諾済みは期限付きで席を保留する。
     */
    confirmedSeats: number;
    requestedSeats: number;
    waitingSeats: number;
    offeredSeats: number;
    /** 定員があれば残席。上限なし(null)や計算不能なら null。 */
    remainingSeats: number | null;
  };
  /*
   * IDEA-29: 繰上げ履歴。終了した待ち行(予約化・期限切れ・本人取消)を
   * 新しい順に返す。申込者一覧(applicants)は稼働中の行だけなので、
   * 結果が出た案内の追跡はこちらで見る。
   */
  waitlistHistory: Array<{
    id: string;
    friendId: string;
    displayName: string | null;
    status: string;
    partySize: number;
    createdAt: string;
    offeredAt: string | null;
    offerExpiresAt: string | null;
    notifiedAt: string | null;
    updatedAt: string;
    /** 予約へ繰り上がった場合だけ、その予約ID。 */
    convertedBookingId: string | null;
  }>;
  /*
   * IDEA-29: 当日受付。この開催回で参加済・無断欠席に記録した人。
   * 確定のままの人は受付前として summary.confirmedSeats で分かる。
   */
  attendance: {
    attendedSeats: number;
    noShowSeats: number;
    entries: Array<{
      id: string;
      friendId: string;
      displayName: string | null;
      status: string;
      partySize: number;
      /** 状態を最後に更新した日時(内部メモの更新でも変わる)。 */
      markedAt: string;
    }>;
  };
  applicants: Array<{
    source: 'booking' | 'waitlist';
    id: string;
    friendId: string;
    displayName: string | null;
    pictureUrl: string | null;
    status: string;
    partySize: number;
    appliedAt: string;
    answers: unknown | null;
    firstParticipation: {
      isFirst: boolean | null;
      attendedCount: number | null;
      checkedAt: string | null;
    };
    /** キャンセル待ちへの案内中だけ入る。予約済み行は null のまま。 */
    offeredAt: string | null;
    /** 案内を受け付ける期限。案内中でなければ null。 */
    offerExpiresAt: string | null;
  }>;
}
