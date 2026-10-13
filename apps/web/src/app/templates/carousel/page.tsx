'use client'
import CarouselEditorV8 from '@/v8/templates/carousel'
import { buildCarouselActions, buildCarouselContent, saveCarousel } from '@/v8/templates/carousel-core'



/**
 * カルーセルの編集。
 *
 * JSONを手で書かずに済むようにする。制限（LINEの決まり）を入力の
 * そばに出して、保存する前に気づけるようにしている。
 */


function CarouselEditorInner() { return <CarouselEditorV8 /> }

function CarouselEditorPage() { return <CarouselEditorInner /> }


/*
 * 試験から触れる口。**画面を組み立て直さずに、実際に動く部品を呼ぶ。**
 * ここに出すのは、画面本体がそのまま使っている関数と部品だけ。
 */
const CarouselEditorPageWithTestSupport = Object.assign(CarouselEditorPage, {
  __testing: {
    CarouselEditorInner,
    buildCarouselActions,
    buildCarouselContent,
    saveCarousel,
  },
})


export default CarouselEditorPageWithTestSupport
