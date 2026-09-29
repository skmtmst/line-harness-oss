/** 秘密値の下限。手で決めさせると必ず短いものが混ざる。 */
export const MIN_SECRET_LENGTH = 32

/**
 * 推測されない秘密値をブラウザで作る。
 *
 * 一覧と作成の2画面で別方式(btoa方式とhex方式)を持っていたが、
 * 桁数・文字種の仕様変更時に直し漏れが出るのでここに寄せる(#506 軽)。
 * 24バイトの乱数を16進48文字にする。口側の32文字下限を満たす。
 */
export function generateSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
