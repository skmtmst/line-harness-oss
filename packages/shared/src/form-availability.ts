/** 開いた時点の受付状況。送信時には必ず再検査する。 */
export interface FormAvailability {
  accepting: boolean;
  reason: string | null;
  deadlineAt: string | null;
  oncePerFriend: boolean;
  totalRemaining: number | null;
  choices: Record<string, Record<string, { remaining: number; full: boolean }>>;
}
