import { createCipheriv } from "node:crypto";

/**
 * Bank Alfalah (APG) payments, server side. Mount it once:
 *   // app/api/alfa/[action]/route.ts
 *   import { alfaHandlers } from "alfa-pay/server";
 *   export const { GET, POST } = alfaHandlers();
 * Routes: pay (card redirect), start/confirm (Wallet & Bank Account API), return (card return).
 */

export type AlfaOptions = {
  /** Look the order up in YOUR database. The amount you return is used, never the one sent by the browser. */
  getOrder?: (orderId: string) => Promise<{ amount: number } | null> | { amount: number } | null;
  /** Called on the server once APG confirms the order is paid. May be called more than once per order. */
  onPaid?: (orderId: string) => Promise<void> | void;
  /** Where the customer lands after a card payment. Defaults to ALFA_SUCCESS_URL or `${ALFA_APP_URL}/payment/success`. */
  successUrl?: string;
  failureUrl?: string;
};

type Overrides = Record<string, string | undefined>;

/** Demo only (npm run dev sets ALFA_DEMO=true): lets the demo form pass credentials instead of .env. */
const DEMO = process.env.ALFA_DEMO === "true";

function config(o: Overrides = {}) {
  const env = (name: string) => {
    const v = (DEMO && o[name]) || process.env[name];
    if (!v) throw new Error(`Missing env var ${name}`);
    return v;
  };
  const appUrl = env("ALFA_APP_URL").replace(/\/$/, "");
  return {
    appUrl,
    base: (DEMO && o.ALFA_ENV) || process.env.ALFA_ENV
      ? ((DEMO && o.ALFA_ENV) || process.env.ALFA_ENV) === "live" ? "https://payments.bankalfalah.com" : "https://sandbox.bankalfalah.com"
      : "https://sandbox.bankalfalah.com",
    merchantId: env("ALFA_MERCHANT_ID"),
    storeId: env("ALFA_STORE_ID"),
    merchantHash: env("ALFA_MERCHANT_HASH"),
    username: env("ALFA_MERCHANT_USERNAME"),
    password: env("ALFA_MERCHANT_PASSWORD"),
    key1: env("ALFA_KEY1"),
    key2: env("ALFA_KEY2"),
    // Must equal the Return URL saved in the APG portal (override with ALFA_RETURN_URL if yours differs)
    returnUrl: process.env.ALFA_RETURN_URL || `${appUrl}/api/alfa/return`,
  };
}

/**
 * RequestHash = AES-128-CBC/PKCS7 (key = Key1, iv = Key2) of "a=1&b=2", base64.
 * Mirrors the APG sandbox page: the string is built from EVERY input in the form, in page order,
 * including the (still empty) hash field itself and the submit button, so the callers
 * pass those keys with empty values.
 */
function requestHash(fields: Record<string, string>, key1: string, key2: string) {
  const plain = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("&");
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(key1, "utf8"), Buffer.from(key2, "utf8"));
  return Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]).toString("base64");
}

/** Ask APG for the real order status. It can lag a moment behind the redirect, so retry briefly. */
async function isPaid(c: ReturnType<typeof config>, orderId: string) {
  const statusUrl = `${c.base}/HS/api/IPN/OrderStatus/${c.merchantId}/${c.storeId}/${encodeURIComponent(orderId)}`;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1000));
    let data = await (await fetch(statusUrl, { cache: "no-store" })).json();
    if (typeof data === "string") data = JSON.parse(data); // APG double-encodes this JSON
    if (String(data?.TransactionStatus ?? "").toLowerCase() === "paid") return true;
  }
  return false;
}

type Cfg = ReturnType<typeof config>;
type Spec = { path: string; fields: Record<string, string>; hashKeys: string[] };

/** APG only accepts the international format: 03001234567 / 923001234567 / +923001234567 -> +923001234567 */
function intlMobile(raw = "") {
  const n = String(raw).replace(/[\s-]/g, "");
  if (n.startsWith("+")) return n;
  if (n.startsWith("0")) return `+92${n.slice(1)}`;
  return `+${n}`;
}

// The three REST calls. `hashKeys` = the exact fields (and order) APG hashes; the JSON body carries all `fields`.
const COMMON = ["MerchantId", "StoreId", "ChannelId", "MerchantHash", "MerchantUsername", "MerchantPassword", "ReturnURL", "Currency", "AuthToken", "TransactionTypeId", "TransactionReferenceNumber"];

const handshakeSpec = (c: Cfg, orderId: string): Spec => {
  const fields = {
    HS_ChannelId: "1002",
    HS_MerchantId: c.merchantId,
    HS_StoreId: c.storeId,
    HS_ReturnURL: c.returnUrl,
    HS_MerchantHash: c.merchantHash,
    HS_MerchantUsername: c.username,
    HS_MerchantPassword: c.password,
    HS_TransactionReferenceNumber: orderId,
  };
  return { path: "/HS/api/HSAPI/HSAPI", fields, hashKeys: Object.keys(fields) };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const transactionSpec = (c: Cfg, i: Record<string, any>): Spec => ({
  path: "/HS/api/Tran/DoTran",
  fields: {
    ChannelId: "1002",
    MerchantId: c.merchantId,
    StoreId: c.storeId,
    MerchantHash: c.merchantHash,
    MerchantUsername: c.username,
    MerchantPassword: c.password,
    ReturnURL: i.returnUrl || c.returnUrl,
    Currency: "PKR",
    AuthToken: i.authToken,
    TransactionTypeId: String(i.type ?? "1"),
    TransactionReferenceNumber: i.orderId,
    TransactionAmount: String(Math.round(Number(i.amount))),
    MobileNumber: intlMobile(i.mobile),
    AccountNumber: i.account ?? "",
    Country: String(i.country ?? "164"), // 164 = Pakistan
    EmailAddress: i.email ?? "",
  },
  // AccountNumber, Country and EmailAddress are sent but not hashed
  hashKeys: [...COMMON, "TransactionAmount", "MobileNumber"],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processSpec = (c: Cfg, i: Record<string, any>): Spec => ({
  path: "/HS/api/ProcessTran/ProTran",
  fields: {
    ChannelId: "1002",
    MerchantId: c.merchantId,
    StoreId: c.storeId,
    MerchantHash: c.merchantHash,
    MerchantUsername: c.username,
    MerchantPassword: c.password,
    ReturnURL: i.returnUrl || c.returnUrl,
    Currency: "PKR",
    AuthToken: i.authToken,
    TransactionTypeId: String(i.type ?? "1"),
    TransactionReferenceNumber: i.orderId,
    SMSOTAC: i.smsOtac ?? "",
    EmailOTAC: i.emailOtac ?? "",
    SMSOTP: i.smsOtp ?? "",
    HashKey: i.hashKey,
    IsOTP: String(i.isOTP === "true" || (i.isOTP as unknown) === true),
  },
  hashKeys: [...COMMON, "SMSOTAC", "EmailOTAC", "SMSOTP", "IsOTP", "HashKey"],
});

/** Sign and POST one call. Returns what was sent and what APG answered. */
async function apiCall(c: Cfg, { path, fields, hashKeys }: Spec) {
  const hashed = Object.fromEntries(hashKeys.map((k) => [k, fields[k]]));
  const request = { ...fields, [path.includes("HSAPI") ? "HS_RequestHash" : "RequestHash"]: requestHash(hashed, c.key1, c.key2) };
  const res = await fetch(`${c.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
  });
  const text = await res.text();
  let response;
  try {
    response = JSON.parse(text);
    if (typeof response === "string") response = JSON.parse(response); // APG sometimes double-encodes
  } catch {
    response = { success: "false", ErrorMessage: text.slice(0, 200) };
  }
  return { url: `${c.base}${path}`, request, response };
}

/**
 * Alfa Wallet (type 1) / Alfalah Bank Account (type 2), steps 1+2: handshake, then transaction request.
 * APG then sends the customer an OTP; the browser calls /api/alfa/confirm with it.
 */
async function start(req: Request, o: AlfaOptions) {
  const input = await req.json();
  const { type = "1", account, mobile, email, country, credentials } = input;
  const resolved = await resolveOrder(input, o);
  if ("error" in resolved) return resolved.error;
  const { amount, orderId } = resolved;
  const c = config(credentials);

  const { response: hs } = await apiCall(c, handshakeSpec(c, orderId));
  if (hs.success !== "true") return Response.json({ error: `Handshake failed: ${hs.ErrorMessage}`, detail: hs.ErrorMessage, step: "handshake" }, { status: 502 });

  const { response: tx } = await apiCall(
    c,
    transactionSpec(c, { orderId, amount, type, account, mobile, email, country, authToken: hs.AuthToken, returnUrl: hs.ReturnURL }),
  );
  if (tx.success !== "true") return Response.json({ error: `Transaction request failed: ${tx.ErrorMessage}`, detail: tx.ErrorMessage, step: "transaction", raw: tx }, { status: 502 });

  // isOTP "true" = wallet OTP (SMSOTP); otherwise bank-account OTACs (SMS + email)
  return Response.json({
    orderId,
    type: String(type),
    authToken: tx.AuthToken,
    hashKey: tx.HashKey,
    isOTP: tx.IsOTP === "true",
    returnUrl: hs.ReturnURL || c.returnUrl,
  });
}

/** Step 3: process the transaction with the OTP(s), then confirm with APG's own order status. */
async function confirm(req: Request, o: AlfaOptions) {
  const { credentials, ...input } = await req.json();
  const c = config(credentials);
  const { response: tx } = await apiCall(c, processSpec(c, input));
  const paid = tx.response_code === "00" && (await isPaid(c, input.orderId)); // double-check with APG
  if (paid) await o.onPaid?.(input.orderId);
  return Response.json({ paid, orderId: input.orderId, code: tx.response_code ?? "", message: tx.description ?? tx.ErrorMessage ?? "", step: "confirm", raw: tx });
}

/**
 * Demo only: run ONE step and show the exact request and response (the manual step-by-step page).
 * The request contains your credentials, so this is disabled unless ALFA_DEMO=true.
 */
async function step(req: Request) {
  if (!DEMO) return Response.json({ error: "Not found" }, { status: 404 });
  const { step: name, input = {}, credentials } = await req.json();
  const c = config(credentials);
  const spec = name === "handshake" ? handshakeSpec(c, input.orderId) : name === "transaction" ? transactionSpec(c, input) : processSpec(c, input);
  return Response.json(await apiCall(c, spec));
}

async function pay(req: Request, o: AlfaOptions) {
  const input = await req.json();
  const { credentials } = input;
  const resolved = await resolveOrder(input, o);
  if ("error" in resolved) return resolved.error;
  const { amount, orderId } = resolved;
  const c = config(credentials);

  // Step 1: handshake, get an AuthToken
  // Key order = field order of the APG sandbox handshake form (HS_IsRedirectionRequest=0 returns JSON)
  const hs: Record<string, string> = {
    HS_RequestHash: "",
    HS_IsRedirectionRequest: "0",
    HS_ChannelId: "1001",
    HS_ReturnURL: c.returnUrl,
    HS_MerchantId: c.merchantId,
    HS_StoreId: c.storeId,
    HS_MerchantHash: c.merchantHash,
    HS_MerchantUsername: c.username,
    HS_MerchantPassword: c.password,
    HS_TransactionReferenceNumber: orderId,
    handshake: "", // the sandbox page's submit button is part of the hashed string
  };
  const { handshake: _btn, ...hsBody } = hs;
  hsBody.HS_RequestHash = requestHash(hs, c.key1, c.key2);

  const res = await fetch(`${c.base}/HS/HS/HS`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(hsBody),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!data || data.success !== "true" || !data.AuthToken) {
    return Response.json({ error: `Handshake failed: ${data?.ErrorMessage ?? res.status}`, detail: data?.ErrorMessage, step: "handshake" }, { status: 502 });
  }

  // Step 2: build the data the browser posts to the APG checkout page
  // Key order = field order of the APG sandbox redirection form. APG only accepts whole-number amounts.
  const sso: Record<string, string> = {
    AuthToken: data.AuthToken,
    RequestHash: "",
    ChannelId: "1001",
    Currency: "PKR",
    IsBIN: "0",
    ReturnURL: data.ReturnURL || c.returnUrl,
    MerchantId: c.merchantId,
    StoreId: c.storeId,
    MerchantHash: c.merchantHash,
    MerchantUsername: c.username,
    MerchantPassword: c.password,
    TransactionTypeId: "3",
    TransactionReferenceNumber: orderId,
    TransactionAmount: String(Math.round(amount)),
    run: "",
  };
  const fields: Record<string, string> = { ...sso, RequestHash: requestHash(sso, c.key1, c.key2) };
  delete fields.run;
  const out = Response.json({ action: `${c.base}/SSO/SSO/SSO`, fields, orderId });
  if (DEMO && credentials) {
    // Demo only: remember the non-secret ids for the return check. Nothing else is kept.
    const demo = { ALFA_APP_URL: c.appUrl, ALFA_ENV: credentials.ALFA_ENV, ALFA_MERCHANT_ID: c.merchantId, ALFA_STORE_ID: c.storeId };
    out.headers.append("Set-Cookie", `alfa_demo=${encodeURIComponent(JSON.stringify(demo))}; HttpOnly; Max-Age=900; Path=/; SameSite=Lax`);
  }
  return out;
}

/** APG returns the customer with ?O=<orderId>. Never trust the URL: ask APG for the real status. */
async function back(req: Request, o: AlfaOptions) {
  let demo: Overrides = {};
  try { demo = JSON.parse(decodeURIComponent(req.headers.get("cookie")?.match(/alfa_demo=([^;]+)/)?.[1] ?? "{}")); } catch {}
  const c = DEMO ? { ...config({ ...demo, ALFA_MERCHANT_HASH: "-", ALFA_MERCHANT_USERNAME: "-", ALFA_MERCHANT_PASSWORD: "-", ALFA_KEY1: "-", ALFA_KEY2: "-" }) } : config();
  const q = new URL(req.url).searchParams;
  const orderId = q.get("O") ?? "";
  let paid = false;
  if (orderId) {
    try {
      paid = await isPaid(c, orderId);
      if (paid) await o.onPaid?.(orderId);
    } catch (e) {
      console.error("[alfa] status check failed", e);
    }
  }
  const target = paid
    ? o.successUrl ?? process.env.ALFA_SUCCESS_URL ?? `${c.appUrl}/payment/success`
    : o.failureUrl ?? process.env.ALFA_FAILURE_URL ?? `${c.appUrl}/payment/failed`;
  // status is verified with APG above; code/reason are APG's RC/RD from the URL (display only, never trust them)
  const out = new URLSearchParams({ order: orderId, status: paid ? "paid" : "failed" });
  if (q.get("RC")) out.set("code", q.get("RC")!);
  if (q.get("RD")) out.set("reason", q.get("RD")!);
  return Response.redirect(`${target}?${out}`, 303);
}

/** Amount comes from getOrder(orderId) when provided; otherwise from the request (fine for testing only). */
async function resolveOrder(input: { amount?: number; orderId?: string }, o: AlfaOptions) {
  if (o.getOrder) {
    if (!input.orderId) return { error: Response.json({ error: "orderId is required" }, { status: 400 }) };
    const order = await o.getOrder(input.orderId);
    if (!order) return { error: Response.json({ error: "Unknown order" }, { status: 404 }) };
    return { amount: order.amount, orderId: input.orderId };
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: Response.json({ error: "Invalid amount" }, { status: 400 }) };
  return { amount, orderId: input.orderId ?? `ORD${Date.now()}` };
}

export function alfaHandlers(o: AlfaOptions = {}) {
  const handle = async (req: Request) => {
    const action = new URL(req.url).pathname.replace(/\/$/, "").split("/").pop();
    try {
      if (action === "return") return await back(req, o);
      if (req.method === "POST") {
        if (action === "pay") return await pay(req, o);
        if (action === "start") return await start(req, o);
        if (action === "confirm") return await confirm(req, o);
        if (action === "step") return await step(req);
      }
    } catch (e) {
      console.error("[alfa]", e);
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status: 500 });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  };
  return { GET: handle, POST: handle };
}
