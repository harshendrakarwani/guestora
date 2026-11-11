import test from "node:test";
import assert from "node:assert/strict";
import { canClaimPassSend, canStartRefund, canResumeCheckout, canReconcileOrder } from "../lib/payment-safety.ts";

test("a refund can only be claimed from paid state", () => {
  assert.equal(canStartRefund("paid"), true);
  for (const state of ["pending", "authorized", "failed", "refund_processing", "refund_pending", "refunded"]) {
    assert.equal(canStartRefund(state), false, `${state} must not create another refund`);
  }
});

test("repeated refund request while processing, pending, or complete cannot claim again", () => {
  assert.equal(canStartRefund("refund_processing"), false);
  assert.equal(canStartRefund("refund_pending"), false);
  assert.equal(canStartRefund("refunded"), false);
});

test("closing checkout keeps pending and authorized payments resumable", () => {
  assert.equal(canResumeCheckout("pending"), true);
  assert.equal(canResumeCheckout("authorized"), true);
  assert.equal(canResumeCheckout("paid"), false);
  assert.equal(canResumeCheckout("failed"), false);
});

test("failed orders are still reconciled for a late capture; refunding or paid orders are not", () => {
  assert.equal(canReconcileOrder("failed"), true);
  assert.equal(canReconcileOrder("pending"), true);
  assert.equal(canReconcileOrder("paid"), false);
  assert.equal(canReconcileOrder("refund_processing"), false);
  assert.equal(canReconcileOrder("refund_pending"), false);
  assert.equal(canReconcileOrder("refunded"), false);
});

test("an in-flight WhatsApp pass cannot be claimed a second time", () => {
  assert.equal(canClaimPassSend("sending"), false);
  assert.equal(canClaimPassSend(null), true);
  assert.equal(canClaimPassSend("failed"), true);
  assert.equal(canClaimPassSend("accepted"), true);
});
