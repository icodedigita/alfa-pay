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
ALFA_ENV=sandbox                       # sandbox | live (switches every Bank Alfalah URL)
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

Keys: `success`, `failed`, `invalidAccount`, `invalidMobile`, `invalidCode`, `couldNotStart`, `insufficientFunds`, `limitExceeded`, `cardExpired`, `cancelled`, `network`.

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

## Testing locally with a tunnel

**Why you need one.** After a card payment, Bank Alfalah sends the customer's browser back to your site, and the APG portal only accepts a public **https** Return URL. `http://localhost:3000` is neither public nor https, so for card payments you need a *tunnel*: a free tool that gives your local app a temporary public https address.

Wallet and bank account payments don't redirect the customer, but every request still carries your Return URL, so use the same https setup for them too.

**Step by step**

1. Start your app: `npm run dev` (it listens on port 3000).
2. In a second terminal, start a tunnel. With Cloudflare's free `cloudflared` (`brew install cloudflared` on macOS, other systems: see Cloudflare's install docs):

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   It prints an address like `https://random-words.trycloudflare.com`. Copy it. ([ngrok](https://ngrok.com) works the same way: `ngrok http 3000`.)
3. Put that address in `.env.local` and restart `npm run dev`:

   ```bash
   ALFA_APP_URL=https://random-words.trycloudflare.com
   ```

4. Next.js blocks dev requests from unknown hostnames, so allow the tunnel host in `next.config.js`:

   ```js
   module.exports = { allowedDevOrigins: ["random-words.trycloudflare.com"] };
   ```

5. In the APG portal (**Dashboard → Credentials Generator**) set the **Return URL** to `https://random-words.trycloudflare.com/api/alfa/return` and save. The Listener URL can be the same address; it isn't used. If you saved a different Return URL, for example just the site root, set `ALFA_RETURN_URL` to exactly that value instead.
6. Open the **tunnel address** in your browser (not `localhost`) and make a payment.

**Good to know**

- A free quick tunnel gets a **new address every time you restart it**. Repeat steps 3 to 5 each time, or use a named Cloudflare tunnel on your own domain so the address never changes.
- Keep the tunnel and `npm run dev` running during the whole payment, because the customer comes back through the tunnel.
- Use the test cards and accounts under **Dashboard → Sample Data For Testing** in the portal. Check the card's expiry date: expired sample cards are rejected with "Card Expired".
- Wallet test OTP: `12341234`.
- Mobile numbers can be typed in any common Pakistani format (`0300 1234567`, `3001234567`, `923001234567`, `00923001234567`, `+92 300 1234567`). They are always sent to Bank Alfalah in international format with a leading `+`, e.g. `+923001234567`. Anything that isn't a valid Pakistani mobile is rejected before calling the bank.
- Amounts must be whole numbers (PKR).

**Troubleshooting**

| What you see | Likely cause |
|---|---|
| "We could not start this payment" (`Invalid Request`) | The order ID was already used (use a new one), or a credential or key is wrong |
| After paying, the page is a 404 or never returns to your site | The portal's Return URL doesn't match the tunnel address, or the tunnel restarted with a new address |
| Page loads but buttons don't respond, or the console mentions a blocked cross-origin request | Add the tunnel host to `allowedDevOrigins` (step 4) |
| "Card Expired" | The sample card's expiry date has passed; try another card from Sample Data |
| "We could not find that account" (`Invalid Account`) | Wrong wallet or account number for this store |
| "That code is incorrect or has expired" | Wrong OTP; the sandbox wallet OTP is `12341234` |

## Going live

1. Generate production credentials in the portal (**Go Live**) and ask your Bank Alfalah business owner for the production Key1 and Key2.
2. Set `ALFA_ENV=live` with the production values.
3. Use `getOrder` so the amount always comes from your database.

## Sandbox and live

One setting switches everything: `ALFA_ENV=sandbox` (default) or `ALFA_ENV=live`. Every call (card handshake and payment page, API handshake, transaction request, OTP processing and the order-status check) then goes to the matching Bank Alfalah host: `sandbox.bankalfalah.com` or `payments.bankalfalah.com`. Any other value is rejected, so a typo can never silently pick the wrong mode.

To go live, swap in the production credentials from the portal (**Go Live**) and the production Key1 and Key2 from your Bank Alfalah business owner, then set `ALFA_ENV=live`. No code changes.

## What has been tested

All three payment methods and both modes are implemented from the APG Merchant Integration Guide. This is what has actually been run:

| | Tested against the sandbox |
|---|---|
| Alfa Wallet (API) | Full payment to `PAID` |
| Card (redirect) | Handshake, payment page and return handling; a successful card payment wasn't seen because the sandbox sample cards have expired |
| Alfalah Bank Account (API) | Same flow as the wallet with transaction type 2; not run yet because it needs a sandbox bank account and its SMS/email OTACs |
| Live mode | URL switching verified; no payment run, since that needs production credentials |

Not included: the optional Bank Alfalah listener (IPN push). The return page checks the payment status with Bank Alfalah instead.

## Disclaimer

Unofficial community package. Not affiliated with or endorsed by Bank Alfalah. Test thoroughly in the sandbox before taking real payments.

## License

MIT
