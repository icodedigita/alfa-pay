# alfa-pay

Bank Alfalah (APG) payments for Next.js. Set your `.env`, add one route file, drop in `<AlfaPay />`.

- **Card**: redirects to Bank Alfalah's secure payment page.
- **Alfa Wallet** and **Alfalah Bank Account**: pay on your own page with an OTP, no redirect.
- The server verifies every payment with Bank Alfalah before reporting it as paid.

Works with the Next.js App Router (Next 14+, React 18+).

## Install

```bash
npm i alfa-pay
```

## 1. Environment

Copy the values from your APG merchant portal (**Go Live → Access Sandbox → Integration → Page Redirection**, HTML block at the bottom) into `.env.local`:

```bash
ALFA_ENV=sandbox                       # sandbox | live
ALFA_APP_URL=https://your-site.com     # public https URL of your site
ALFA_MERCHANT_ID=
ALFA_STORE_ID=
ALFA_MERCHANT_USERNAME=
ALFA_MERCHANT_PASSWORD=
ALFA_MERCHANT_HASH=
ALFA_KEY1=                             # 16 characters (encryption key)
ALFA_KEY2=                             # 16 characters (encryption IV)

# Optional
# ALFA_RETURN_URL=https://your-site.com/   # only if the Return URL saved in the portal is not ALFA_APP_URL/api/alfa/return
# ALFA_SUCCESS_URL=https://your-site.com/payment/success
# ALFA_FAILURE_URL=https://your-site.com/payment/failed
```

In the APG portal, set the **Return URL** to `https://your-site.com/api/alfa/return`.

## 2. Server route

`app/api/alfa/[action]/route.ts`:

```ts
import { alfaHandlers } from "alfa-pay/server";

export const { GET, POST } = alfaHandlers();
```

## 3. Component

```tsx
import { AlfaPay } from "alfa-pay";

<AlfaPay amount={2500} orderId="ORDER-1001" onSuccess={(orderId) => console.log("paid", orderId)} />
```

The customer chooses Card, Alfa Wallet or Alfalah Bank Account. For wallet and bank account they enter their number, mobile and email, then the OTP Bank Alfalah sends them.

## 4. Card result pages

After a card payment the customer returns to `/payment/success?order=…&status=paid` or `/payment/failed?order=…&status=failed&reason=…`. Show the result with one line on each page:

```tsx
import { AlfaResult } from "alfa-pay";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <AlfaResult {...await searchParams} />;
}
```

## Server options (`alfaHandlers`)

```ts
export const { GET, POST } = alfaHandlers({
  // Use YOUR price, never the browser's. Strongly recommended in production.
  getOrder: async (orderId) => {
    const order = await db.orders.find(orderId);
    return order ? { amount: order.total } : null;
  },
  // Called once Bank Alfalah confirms payment. May be called more than once for an order, so make it idempotent.
  onPaid: async (orderId) => {
    await db.orders.markPaid(orderId);
  },
  // Optional: override where card customers land
  // successUrl: "/thanks", failureUrl: "/try-again",
});
```

When `getOrder` is set, `<AlfaPay orderId="…" />` is enough and any `amount` sent by the browser is ignored.

## Customizing messages and alerts

Every message shown to your customers can be changed:

```tsx
<AlfaPay
  amount={2500}
  messages={{ success: "Shukriya! Your order is confirmed.", invalidCode: "Wrong code, please retry." }}
/>
```

Keys: `success`, `failed`, `invalidAccount`, `invalidCode`, `couldNotStart`, `insufficientFunds`, `limitExceeded`, `cardExpired`, `cancelled`, `network`.

Style the default alert with CSS variables, or replace it completely:

```css
.alfa { --alfa-accent: #0a7; --alfa-radius: 12px; }
.alfa-alert { --alfa-success: #0a7; --alfa-error: #c00; }
```

```tsx
<AlfaPay amount={2500} renderAlert={({ kind, message }) => toast[kind](message)} />
```

Add `showBankDetail` to also show Bank Alfalah's own wording under the message (useful while testing). `AlfaResult` accepts the same `messages`, `renderAlert` and `showBankDetail` props.

Messages are matched on the bank's wording. `Invalid Account`, `Invalid Transaction` (wrong OTP) and `Invalid Request` were seen in the sandbox; the other cases are best effort, and anything unrecognised shows `failed`.

## Testing in the sandbox

- Card payments need a **public https** Return URL. Locally, use a tunnel such as `npx cloudflared tunnel --url http://localhost:3000` and set `ALFA_APP_URL` to the address it prints.
- Use the test cards and accounts under **Dashboard → Sample Data For Testing** in the portal.
- Wallet test OTP: `12341234`.
- Mobile numbers may be typed as `0300…`, `92300…` or `+92300…`; they are sent to Bank Alfalah as `+92300…`.
- Amounts must be whole numbers (PKR).

## Going live

1. Generate production credentials in the portal (**Go Live**) and ask your Bank Alfalah business owner for the production Key1 and Key2.
2. Set `ALFA_ENV=live` with the production values.
3. Use `getOrder` so the amount always comes from your database.

## Status

| Method | State |
|---|---|
| Alfa Wallet (API) | Verified end to end in the sandbox |
| Card (redirect) | Redirect, payment page and return verified; a successful card payment was not seen because the sandbox sample cards have expired |
| Alfalah Bank Account (API) | Implemented, not yet tested (needs a sandbox account number and SMS/email OTACs) |
| Live mode | Not tested |
| Bank Alfalah listener (IPN push) | Not implemented; the return page verifies status instead |

## Disclaimer

Unofficial community package. Not affiliated with or endorsed by Bank Alfalah. Test thoroughly in the sandbox before taking real payments.

## License

MIT
