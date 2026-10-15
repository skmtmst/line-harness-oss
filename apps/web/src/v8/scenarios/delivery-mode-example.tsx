import { DataTable, NameCell, Tr, Td } from '@/components/shared/table'
import SectionHeader from '@/components/shared/section-header'

/** 購読を始める時刻だけが違う2人で、届く時刻の違いを示す。 */
export default function DeliveryModeExample({ mode }: { mode: 'absolute_time' | 'elapsed' | 'relative' }) {
  const absolute = mode === 'absolute_time'
  return <>
    <SectionHeader size="small" title="見本：同じ日の違う時刻に購読を始めた2人（日本時間）" />
    <DataTable aria-label="選んだ配信方式の見本">
      <tbody>
        <Tr>
          <NameCell name="友だち A" /><Td>4/1 12:00 に開始</Td><Td>1通目 4/1 15:00</Td><Td>2通目 4/2 20:00</Td>
        </Tr>
        <Tr>
          <NameCell name="友だち B" /><Td>4/1 14:00 に開始</Td><Td>{`1通目 4/1 ${absolute ? '15:00' : '17:00'}`}</Td><Td>{`2通目 4/2 ${absolute ? '20:00' : '22:00'}`}</Td>
        </Tr>
      </tbody>
    </DataTable>
    <SectionHeader size="small" title={absolute ? '時刻で指定は、2人とも同じ時刻に届きます' : `${mode === 'relative' ? '登録からの相対時間' : '経過時間で指定'}は、始めた時刻に合わせてずれて届きます（夜中に届くことがあります）`} />
  </>
}
