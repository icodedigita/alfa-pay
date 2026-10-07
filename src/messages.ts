/** Public-facing wording. Override any key with the `messages` prop. */
export type AlfaMessages = {
  success: string;
  failed: string;
  invalidAccount: string;
  invalidMobile: string;
  invalidCode: string;
  couldNotStart: string;
  insufficientFunds: string;
  limitExceeded: string;
  cardExpired: string;
  cancelled: string;
  network: string;
};

export const defaultMessages: AlfaMessages = {
  success: "Payment successful. Thank you!",
  failed: "Your payment could not be completed. You have not been charged. Please try again.",
  invalidAccount: "We could not find that account. Please check the account number and try again.",
  invalidMobile: "Please enter a valid Pakistani mobile number, for example 0300 1234567.",
  invalidCode: "That code is incorrect or has expired. Please check it and try again.",
  couldNotStart: "We could not start this payment. Please refresh and try again.",
  insufficientFunds: "Insufficient balance. Please use another account or method.",
  limitExceeded: "This payment exceeds the limit on your account.",
  cardExpired: "This card has expired. Please use another card.",
  cancelled: "The payment was cancelled.",
  network: "We could not reach the payment service. Please check your connection and try again.",
};

/**
 * Turn what Bank Alfalah said into one of our messages. Matched on the bank's wording, and only
 * "Invalid Account", "Invalid Transaction" (wrong code) and "Invalid Request" were seen in the sandbox;
 * the others are best-effort. Anything unrecognised falls back to `failed`.
 */
export function failureMessage(detail: string | undefined, step: string | undefined, m: AlfaMessages): string {
  const t = (detail ?? "").toLowerCase();
  if (/invalid account/.test(t)) return m.invalidAccount;
  if (/invalid mobile/.test(t)) return m.invalidMobile;
  if (step === "confirm" && /invalid (transaction|otp|otac)|incorrect|expired otp/.test(t)) return m.invalidCode;
  if (step === "handshake" && /invalid request/.test(t)) return m.couldNotStart;
  if (/insufficient|balance/.test(t)) return m.insufficientFunds;
  if (/limit/.test(t)) return m.limitExceeded;
  if (/card expired|expired card/.test(t)) return m.cardExpired;
  if (/cancel/.test(t)) return m.cancelled;
  return m.failed;
}
