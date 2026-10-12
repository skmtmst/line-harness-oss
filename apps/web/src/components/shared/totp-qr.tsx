import CodeBlock from './code-block'
import { Field } from './form-controls'
import { Skeleton } from './skeleton'

export default function TotpQr({ qr, manualKey }: { qr: string; manualKey: string }) {
  return <Field label="認証アプリで読み取るQRコード" note="読み取れないときは、このキーを手で入力してください">
    {qr ? (
      // eslint-disable-next-line @next/next/no-img-element -- locally generated data URI
      <img src={qr} alt="認証アプリ登録用のQRコード" width={200} height={200} />
    ) : <Skeleton />}
    <CodeBlock>{manualKey}</CodeBlock>
  </Field>
}
