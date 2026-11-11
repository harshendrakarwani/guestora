export type PaymentState = "pending" | "authorized" | "failed" | "paid" | "refund_processing" | "refund_pending" | "refunded";
export const RESUMABLE_PAYMENT_STATES: readonly PaymentState[] = ["pending", "authorized"];

/** A refund request may only claim a payment that is still recorded as paid. */
export function canStartRefund(status: PaymentState): boolean {
  return status === "paid";
}

/** Closing checkout does not cancel the provider order; it remains resumable. */
export function canResumeCheckout(status: PaymentState): boolean {
  return RESUMABLE_PAYMENT_STATES.includes(status);
}

/** Failed orders still need reconciliation because a delayed capture can arrive. */
export function canReconcileOrder(status: PaymentState): boolean {
  return status !== "paid" && status !== "refund_processing" && status !== "refund_pending" && status !== "refunded";
}

/** A pass in flight cannot safely be sent again until its result is known. */
export function canClaimPassSend(status: string | null): boolean {
  return status !== "sending";
}
