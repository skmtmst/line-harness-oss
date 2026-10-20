/** 模擬の結果は、実際に送信・返金が完了した結果へ読み替えない。 */
export interface SimulatedPaymentResult {
  simulation: true
  sent: false
}

export interface PaymentLinkPreview extends SimulatedPaymentResult {
  paymentId: string
  checkoutUrl: string | null
}
