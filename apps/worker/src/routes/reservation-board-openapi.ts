const account={name:'account_id',in:'query',required:true,schema:{type:'string'}};
const responses={'200':{description:'担当範囲内の共通予約表示。kind=people、version=lock_version。'},'400':{description:'範囲・版・日時の入力不正'},'401':{description:'未認証'},'403':{description:'権限なし・閲覧のみ'},'404':{description:'予約または担当範囲が見つからない'},'409':{description:'予約の版・空きが変わった。元の予約は保持する。'}};
export const reservationBoardPaths={
 '/api/booking/admin/board':{get:{summary:'人の予約を共通盤の表示型で読む',parameters:[account,...['from','to'].map(name=>({name,in:'query',required:true,schema:{type:'string',format:'date-time'}})),...['limit','offset'].map(name=>({name,in:'query',schema:{type:'integer',minimum:name==='limit'?1:0,...(name==='limit'?{maximum:500}:{})}}))],responses}},
 '/api/booking/admin/board/{id}':{patch:{summary:'共通盤から版を確かめて人の予約を移動',parameters:[account,{name:'id',in:'path',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['kind','expectedVersion','startsAt'],properties:{kind:{const:'people'},expectedVersion:{type:'integer',minimum:0},startsAt:{type:'string',format:'date-time'},staffId:{type:'string'}}}}}},responses}},
};
