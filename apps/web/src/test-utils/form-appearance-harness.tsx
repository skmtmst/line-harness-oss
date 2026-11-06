import { useState } from 'react'
import { FORM_THEME_DEFAULT, type FormOptions, type FormTheme } from '@line-crm/shared'
import { AppearanceTab } from '@/v8/form-edit/public/appearance-tab/index'

/** 現役の設定を、編集ページと同じ親の状態へ接続して操作する。 */
export default function FormAppearanceHarness(props: {
  formId: string
  accountId: string | null
  value?: FormTheme
  ogTitle: string
  ogDescription: string
  ogImageUrl: string
  onChange: (next: FormTheme) => void
  onOgTitleChange: (next: string) => void
  onOgDescriptionChange: (next: string) => void
  onOgImageUrlChange: (next: string) => void
}) {
  const [options, setOptions] = useState<FormOptions>({ theme: props.value ?? { ...FORM_THEME_DEFAULT } })
  const [ogTitle, setOgTitle] = useState(props.ogTitle)
  const [ogDescription, setOgDescription] = useState(props.ogDescription)
  const [ogImageUrl, setOgImageUrl] = useState(props.ogImageUrl)
  return <AppearanceTab options={options} accountId={props.accountId} name="試験のフォーム" nameError={null} description=""
    ogTitle={ogTitle} ogDescription={ogDescription} ogImageUrl={ogImageUrl}
    onChangeOptions={next => { setOptions(current => ({ ...current, ...next })); if (next.theme) props.onChange(next.theme) }}
    onChangeName={() => {}} onChangeDescription={() => {}}
    onChangeOgTitle={next => { setOgTitle(next); props.onOgTitleChange(next) }}
    onChangeOgDescription={next => { setOgDescription(next); props.onOgDescriptionChange(next) }}
    onChangeOgImageUrl={next => { setOgImageUrl(next); props.onOgImageUrlChange(next) }} />
}
