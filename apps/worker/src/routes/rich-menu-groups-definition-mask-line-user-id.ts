export /**
 * 宛先の明示に使う LINE ユーザーIDの表示用マスク。宛先確認だけできればよい
 * ので、全桁は出さない。
 */
function maskLineUserId(lineUserId: string): string {
  if (lineUserId.length <= 9) return lineUserId;
  return `${lineUserId.slice(0, 5)}…${lineUserId.slice(-4)}`;
}
