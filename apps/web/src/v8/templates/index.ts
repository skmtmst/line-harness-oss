// この機能が外へ公開する名前。機能内では宣言元を直接読む。
export { default as CarouselV8, panelsFromContent } from './carousel'
export { buildCarouselActions, buildCarouselContent, saveCarousel } from './carousel-core'
export { default as TemplatesListV8 } from './list'
export { default as QuestionNewV8 } from './question-new'
export { messageTypeText } from './words'
export { default as TemplateDeleteDialog } from './delete-dialog'
export { loadTemplateExamples } from './examples'
