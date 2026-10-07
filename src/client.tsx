import { useState, type FormEvent, type ReactNode } from "react";
import { defaultMessages, failureMessage, type AlfaMessages } from "./messages";

export type AlfaMethod = "card" | "wallet" | "account";

export type AlfaPayProps = {
  /** Amount in PKR (whole number). Ignored when your server route uses `getOrder`. */
  amount?: number;
  /** Your own order id. Required when your server route uses `getOrder`. */
  orderId?: string;
  /** Which payment methods to offer. Default: all three. */
  methods?: AlfaMethod[];
  /** Called in the browser after a wallet / bank account payment is confirmed as paid. */
  onSuccess?: (orderId: string) => void;
  onError?: (message: string) => void;
  /** Where you mounted alfaHandlers(). Default "/api/alfa". */
  endpoint?: string;
  /** Demo only: credentials typed into a demo form. Leave unset in your app. */
  credentials?: Record<string, string>;
  /** Override any public-facing message, e.g. messages={{ success: "Shukriya!" }} */
  messages?: Partial<AlfaMessages>;
  /** Also show the bank's own wording under the message (handy while testing). Default false. */
  showBankDetail?: boolean;
  /** Replace the alert completely with your own UI (toast, modal, ...). */
  renderAlert?: (a: AlfaAlertData) => ReactNode;
  className?: string;
};

export type AlfaAlertData = { kind: "success" | "error" | "info"; message: string; detail?: string; onClose?: () => void };

type Started = { orderId: string; type: string; authToken: string; hashKey: string; isOTP: boolean; returnUrl: string };

const LABELS: Record<AlfaMethod, string> = { card: "Credit / Debit card", wallet: "Alfa Wallet", account: "Alfalah Bank Account" };

const CSS = `
.alfa{--alfa-accent:#e4002b;--alfa-border:#d4d4d8;--alfa-radius:8px;font:inherit;max-width:420px}
.alfa label{display:block;margin:10px 0 4px;font-size:.85em}
.alfa input{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--alfa-border);border-radius:var(--alfa-radius);font:inherit}
.alfa .alfa-methods{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.alfa .alfa-method{flex:1;padding:8px 10px;border:1px solid var(--alfa-border);border-radius:var(--alfa-radius);background:transparent;cursor:pointer;font:inherit}
.alfa .alfa-method[aria-pressed=true]{border-color:var(--alfa-accent);box-shadow:0 0 0 1px var(--alfa-accent)}
.alfa .alfa-pay{margin-top:14px;width:100%;padding:10px;border:0;border-radius:var(--alfa-radius);background:var(--alfa-accent);color:#fff;font:inherit;cursor:pointer}
.alfa .alfa-pay:disabled{opacity:.6;cursor:default}
.alfa-alert{--alfa-success:#15803d;--alfa-success-bg:#f0fdf4;--alfa-error:#b91c1c;--alfa-error-bg:#fef2f2;--alfa-info:#1d4ed8;--alfa-info-bg:#eff6ff;display:flex;gap:10px;align-items:flex-start;margin:12px 0;padding:12px 14px;border:1px solid;border-radius:var(--alfa-radius,8px);font:inherit}
.alfa-alert[data-kind=success]{color:var(--alfa-success);background:var(--alfa-success-bg);border-color:var(--alfa-success)}
.alfa-alert[data-kind=error]{color:var(--alfa-error);background:var(--alfa-error-bg);border-color:var(--alfa-error)}
.alfa-alert[data-kind=info]{color:var(--alfa-info);background:var(--alfa-info-bg);border-color:var(--alfa-info)}
.alfa-alert .alfa-alert-body{flex:1}.alfa-alert small{display:block;opacity:.75;margin-top:4px}
.alfa-alert button{background:none;border:0;color:inherit;font-size:1.2em;line-height:1;cursor:pointer}
`;

class ApiError extends Error {
  constructor(message: string, public detail?: string, public step?: string) {
    super(message);
  }
}

const ICON = { success: "✓", error: "!", info: "i" } as const;

/** The default alert. Style it with className, or the --alfa-* CSS variables. */
export function AlfaAlert({ kind, message, detail, onClose, className }: AlfaAlertData & { className?: string }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} data-kind={kind} className={`alfa-alert ${className ?? ""}`}>
      <style>{CSS}</style>
      <strong aria-hidden>{ICON[kind]}</strong>
      <div className="alfa-alert-body">
        {message}
        {detail && <small>{detail}</small>}
      </div>
      {onClose && <button type="button" aria-label="Dismiss" onClick={onClose}>×</button>}
    </div>
  );
}

/**
 * Drop on your success/failed page after a CARD payment. APG sends the customer back to
 * /payment/success?order=..&status=paid  (or ...&status=failed&code=..&reason=..).
 *   <AlfaResult {...searchParams} />
 */
export function AlfaResult({ status, order, reason, messages, showBankDetail, renderAlert, className }: {
  status?: string; order?: string; reason?: string; code?: string;
  messages?: Partial<AlfaMessages>; showBankDetail?: boolean; renderAlert?: AlfaPayProps["renderAlert"]; className?: string;
}) {
  const m = { ...defaultMessages, ...messages };
  const paid = status === "paid";
  const a: AlfaAlertData = paid
    ? { kind: "success", message: m.success, detail: order ? `Order ${order}` : undefined }
    : { kind: "error", message: failureMessage(reason, "confirm", m), detail: showBankDetail ? reason : order ? `Order ${order}` : undefined };
  return <>{renderAlert ? renderAlert(a) : <AlfaAlert {...a} className={className} />}</>;
}

export function AlfaPay({ amount, orderId, methods = ["card", "wallet", "account"], onSuccess, onError, endpoint = "/api/alfa", credentials, messages, showBankDetail = false, renderAlert, className }: AlfaPayProps) {
  const m = { ...defaultMessages, ...messages };
  const [method, setMethod] = useState<AlfaMethod>(methods[0]);
  const [f, setF] = useState({ account: "", mobile: "", email: "" });
  const [otp, setOtp] = useState({ smsOtp: "", smsOtac: "", emailOtac: "" });
  const [started, setStarted] = useState<Started | null>(null);
  const [msg, setMsg] = useState<AlfaAlertData | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (message: string, detail?: string) => {
    setMsg({ kind: "error", message, detail: showBankDetail ? detail : undefined, onClose: () => setMsg(null) });
    onError?.(message);
  };
  // `err` carries what the server said: { detail, step } from a bank rejection, or a thrown network error
  const failFrom = (err: unknown) => {
    if (err instanceof ApiError) return fail(failureMessage(err.detail, err.step, m), err.detail);
    fail(m.network);
  };

  async function call(action: string, body: object) {
    const res = await fetch(`${endpoint}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, credentials }),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({ error: "Unexpected response" })) };
  }
  const check = (r: { ok: boolean; data: { error?: string; detail?: string; step?: string } }) => {
    if (!r.ok) throw new ApiError(r.data.error ?? "Error", r.data.detail ?? r.data.error, r.data.step);
    return r.data;
  };

  async function payCard() {
    setBusy(true);
    setMsg(null);
    try {
      const data = check(await call("pay", { amount, orderId })) as unknown as { action: string; fields: Record<string, string> };
      // Hand the customer over to the Bank Alfalah payment page.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.action;
      for (const [name, value] of Object.entries<string>(data.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      failFrom(e);
      setBusy(false);
    }
  }

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      setStarted(check(await call("start", { amount, orderId, type: method === "wallet" ? "1" : "2", ...f })) as unknown as Started);
    } catch (e) {
      failFrom(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { data } = await call("confirm", { ...started, ...otp });
      if (data.paid) {
        setMsg({ kind: "success", message: m.success, detail: `Order ${data.orderId}` });
        onSuccess?.(data.orderId);
        setStarted(null);
      } else {
        fail(failureMessage(data.message, "confirm", m), data.message);
      }
    } catch (e) {
      failFrom(e);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className={`alfa ${className ?? ""}`}>
      <style>{CSS}</style>
      {methods.length > 1 && !started && (
        <div className="alfa-methods">
          {methods.map((m) => (
            <button key={m} type="button" className="alfa-method" aria-pressed={m === method} onClick={() => { setMethod(m); setMsg(null); }}>
              {LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {method === "card" && (
        <button type="button" className="alfa-pay" disabled={busy} onClick={payCard}>
          {busy ? "Redirecting…" : amount ? `Pay PKR ${amount.toLocaleString()} by card` : "Pay by card"}
        </button>
      )}

      {method !== "card" && !started && (
        <form onSubmit={sendOtp}>
          <label>{method === "wallet" ? "Alfa Wallet number" : "Alfalah account number"}<input required value={f.account} onChange={set("account")} /></label>
          <label>Mobile number<input required inputMode="tel" placeholder="03001234567" value={f.mobile} onChange={set("mobile")} /></label>
          <label>Email<input required type="email" value={f.email} onChange={set("email")} /></label>
          <button className="alfa-pay" disabled={busy}>{busy ? "Sending…" : "Send OTP"}</button>
        </form>
      )}

      {method !== "card" && started && (
        <form onSubmit={confirm}>
          <p>Enter the code Bank Alfalah sent to the customer.</p>
          {started.isOTP ? (
            <label>SMS OTP<input required value={otp.smsOtp} onChange={(e) => setOtp({ ...otp, smsOtp: e.target.value })} /></label>
          ) : (
            <>
              <label>SMS code<input required value={otp.smsOtac} onChange={(e) => setOtp({ ...otp, smsOtac: e.target.value })} /></label>
              <label>Email code<input required value={otp.emailOtac} onChange={(e) => setOtp({ ...otp, emailOtac: e.target.value })} /></label>
            </>
          )}
          <button className="alfa-pay" disabled={busy}>{busy ? "Paying…" : "Pay"}</button>
        </form>
      )}

      {msg && (renderAlert ? renderAlert(msg) : <AlfaAlert {...msg} />)}
    </div>
  );
}
