import {api} from '../../api'
/** 管理画面の通常の取得にlatestEditが付く。409のApiError.dataにも同じ形を返す。 */
export const fetchFormEditState=api.forms.get
