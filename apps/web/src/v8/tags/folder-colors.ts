import { FOLDER_SELECT_COLORS } from '@line-crm/shared'

/* タグのフォルダも全画面共通の9色（API が受け付ける値）を使う。既定は緑（WEB-C09）。 */
export const TAG_FOLDER_COLORS: ReadonlyArray<{ value: string; name: string }> = FOLDER_SELECT_COLORS
export const DEFAULT_TAG_FOLDER_COLOR = FOLDER_SELECT_COLORS.find((color) => color.name === '緑')!.value
