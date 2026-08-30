# AgentPay

![AgentPay logo](public/agentpay-logo.png)

**Your AI assistant can now buy things. AgentPay is the layer that decides what it is allowed to buy — and enforces it.**

An agent connects to AgentPay through an OAuth-protected MCP server. It can *ask* for spending authority, but it can never grant itself any. You sign a narrow, time-boxed **mandate** with your passkey, and every purchase is checked against that mandate at the moment of settlement. Revoke it and the very next checkout fails.

🔗 **Live:** https://agentpay-yuno.vercel.app · **Merchant docs:** https://agentpay-yuno.vercel.app/docs · **Merchant console:** https://agentpay-yuno.vercel.app/developers

---

## The whole idea in one picture

```
        YOU                        THE AGENT                    AGENTPAY                    THE STORE
         │                             │                            │                           │
         │  "buy 4 tires, max $1,600"  │                            │                           │
         ├────────────────────────────►│                            │                           │
         │                             │  find_products(store URL)  │                           │
         │                             ├───────────────────────────►│──── reads the store's ───►│
         │                             │◄─── exact ids & prices ────┤     own catalog           │
         │                             │                            │                           │
         │                             │  create_mandate(...)       │                           │
         │                             ├───────────────────────────►│                           │
         │   📱 "sign this mandate"    │◄── authorization_url ──────┤                           │
         │◄────────────────────────────┤                            │                           │
         │                             │                            │                           │
         │   ✍️  Face ID / Touch ID    │                            │                           │
         ├─────────────────────────────┼───────────────────────────►│  mandate becomes ACTIVE   │
         │                             │                            │                           │
         │                             │  purchase(product_id)      │                           │
         │                             ├───────────────────────────►│──── signed checkout ─────►│
         │                             │◄── approved + receipt ─────┤◄─── verified ─────────────┤
         │                             │                            │                           │
         │   🛑 "stop"  →  revoke_mandate  →  next checkout is refused, mid-flight ones too      │
```

**The agent never holds money, never sees a card number, and can never approve itself.**
It holds one thing: permission you signed, with limits you chose.

---

# Part 1 — Using AgentPay

> ⏱️ **Total setup time: about 8 minutes.** Steps 1–5 are done once. Step 6 is done once per assistant. Steps 7–10 are what you do every time you shop.

## What you need before you start

| | |
|---|---|
| 📱 **A device with a screen lock** | iPhone, iPad, Mac, or Android with Face ID / Touch ID / fingerprint. This is your signing device. |
| 📧 **An email address you can check** | Including the **spam folder** — see the warning in Step 1. |
| 🪪 **A government ID** | Passport, national ID or driver's licence, for identity verification. |
| 🤖 **An AI assistant that speaks MCP** | Claude, ChatGPT, Gemini, OpenClaw, or any MCP client. |

> ⚠️ **Open AgentPay directly in Safari or Chrome.** Passkeys are bound to the exact hostname `agentpay-yuno.vercel.app`. Embedded browsers (the little in-app browser inside Slack, Instagram, LinkedIn, or a QR scanner app) often cannot reach Face ID or Touch ID, and you will get a confusing failure at signing time.

---

## Step 1 · Create your account

1. Go to **https://agentpay-yuno.vercel.app/dashboard**
2. Click **"New to AgentPay? Create an account"**
3. Enter your email and a password of **at least 8 characters**
4. Click **Create account**

### 📮 THE EMAIL LANDS IN SPAM. GO LOOK IN SPAM.

```
┌──────────────────────────────────────────────────────────────┐
│  🚨  CHECK YOUR SPAM / JUNK FOLDER.  🚨                       │
│                                                              │
│  The confirmation email is sent from:                        │
│                                                              │
│         AgentPay  <auth@fwdco.space>                         │
│                                                              │
│  Gmail, Outlook and iCloud all like to file it as spam,      │
│  because fwdco.space is a young sending domain with no       │
│  reputation history yet.                                     │
│                                                              │
│  It is annoying. There is no way around it today. Just       │
│  open the spam folder, mark it as "Not spam", and click      │
│  the confirmation link.                                      │
│                                                              │
│  Nothing else in the flow will work until you confirm.       │
└──────────────────────────────────────────────────────────────┘
```

**If you cannot find it at all:**

| Try this | Why |
|---|---|
| Search your whole mailbox for `fwdco.space` | Some clients hide spam from the default search |
| Wait 60 seconds and refresh | Delivery is near-instant but not always |
| Check the hourly limit | The project sends **max 30 auth emails per hour**. During a busy demo you can genuinely hit it. Wait, then retry. |
| Use a different provider | A personal Gmail is usually the most reliable; strict corporate filters sometimes drop it entirely |

Once confirmed, come back and **sign in**.

---

## Step 2 · Create your signing passkey

The moment you sign in, AgentPay stops and asks for one thing:

> **Create your authorization passkey**
> This is the only approval credential AgentPay needs. Your device verifies every mandate and exception.

Click **Create passkey** and complete Face ID / Touch ID / your fingerprint.

**What actually happens:** your device generates a keypair. The private key never leaves the secure enclave. AgentPay stores only the *public* credential. There is no password, no OTP, and no shared secret that could be phished out of you or leaked from the database.

> 🔒 **You cannot use AgentPay without a passkey.** That is deliberate — the passkey *is* the authorization mechanism, not a login convenience.

**If the button is greyed out:** you are in an embedded browser or on a device with no screen lock. Open `https://agentpay-yuno.vercel.app` directly in Safari or Chrome and try again.

---

## Step 3 · Verify your identity

Go to **`/account`** → the **"Identity and fraud verification"** card at the top.

1. Read and tick the consent checkbox (it links to Didit's privacy notice and end-user terms)
2. Click **Verify with Didit**
3. You are redirected to Didit's hosted flow: photograph your ID, then a liveness selfie
4. You are returned to `/account`

| Badge you'll see | What it means | What to do |
|---|---|---|
| 🟢 **Verified** | Approved, and your risk entity is `ACTIVE` | Nothing. You can sign mandates. |
| 🟡 **In review** | Didit is doing a manual check | Wait. The webhook updates you automatically. |
| 🟡 **Needs review** | Your entity came back `FLAGGED` | Purchases are blocked until it clears. |
| 🔴 **Not verified** | `Declined` or `BLOCKED` | Purchases are blocked. |
| ⚪ **Required** | Not started yet | Click **Verify with Didit**. |

**Why this gate is real, not decoration:** identity is checked in *three* independent places — when the mandate is signed, when the agent calls `check_purchase`/`purchase`, and again by a database trigger that refuses to mint a payment token for an unverified, flagged or blocked account. A direct API call cannot route around it.

> 🔐 **What AgentPay stores:** the session id, workflow, environment, decision status and entity risk state. **Nothing else.** Your documents, selfies, biometric captures and the full decision stay with Didit.

---

## Step 4 · Add a payment method

Still on **`/account`**, scroll to **"Add payment method"**.

1. Pick a **brand** (Visa or Mastercard)
2. Enter **last four digits** — `4242` is fine
3. Give it a **label** — "Personal", "Fleet card", "Company"
4. Optionally tick **Make this my default payment method**
5. **Save payment method**

> 💡 **Never type a real card number here — there is no field for one.** The payment rail is deliberately mocked for this challenge. AgentPay stores the brand, last four digits, a label, and an encrypted mock-vault reference. That is the entire card record.

**Your agent can also start this for you.** If it calls `get_payment_setup_link`, it gets a **15-minute, user-bound browser link** and hands it to you. It does not, and cannot, collect card data in chat.

```
🚫  No legitimate AgentPay flow will EVER ask you to type a card number,
    CVC, PIN, bank password or vault credential into a chat window.
    If an agent asks, it is not following the protocol. Refuse.
```

**Managing cards later** (all on `/account`):

- **Make default** — the card an agent uses when it does not pick one explicitly
- **Remove** — disabled while a card is bound to a live or pending mandate, so you cannot orphan a signed authorization
- Each card shows its **successful purchase count** and **last used date**

---

## Step 5 · Fill in compliance and delivery details

Two more cards on **`/account`**:

**Order and compliance details** — full legal name, tax ID, phone.
**Delivery address** — street, city, region, postal code, two-letter country code.

Click **Save account details**. Each card shows a **Ready** / **Needs details** badge so you know where you stand.

Your agent reads these through your authenticated connection so it can complete a real order without interrogating you mid-purchase. They never enter a payment token or a public registry record.

---

## Step 6 · Connect your agent 🤖

This is the part people ask about most. Go to **`/connect`**.

The page shows two things: **which assistants are already connected** to your account, and a picker to add another. Click your assistant's logo and it gives you the exact steps plus your link.

### Your connection link is always the same

```
https://agentpay-yuno.vercel.app/mcp
```

That single URL is everything. No API key, no client ID, no secret to paste. Authentication happens through OAuth in your browser.

<br>

### 🟠 Claude (web, desktop, or mobile)

```
1.  Open Claude → Settings → Connectors
2.  Click "Add custom connector"
3.  Paste:   https://agentpay-yuno.vercel.app/mcp
4.  Click Add. Claude opens a browser window.
5.  Sign in to AgentPay (or create the account right there)
6.  Approve the consent screen
7.  Done — "AgentPay" appears in your connector list
```

### 🟢 ChatGPT

```
1.  Open ChatGPT → Settings → Connectors
2.  Add a connector
3.  Paste:   https://agentpay-yuno.vercel.app/mcp
4.  Sign in to AgentPay when ChatGPT redirects you
5.  Approve the consent screen
```

### 🔵 Gemini

```
1.  Open Gemini → Extensions / Tools settings
2.  Add a new connector
3.  Paste:   https://agentpay-yuno.vercel.app/mcp
4.  Sign in to AgentPay when prompted
```

### 🐾 OpenClaw

```
1.  Open OpenClaw → Connectors / Tools settings
2.  Add a new connector
3.  Paste:   https://agentpay-yuno.vercel.app/mcp
4.  Sign in to AgentPay when prompted
```

### ⚙️ Any other MCP client (config-file style)

For clients configured by file — Claude Desktop, Cursor, a local `.mcp.json`, your own agent framework — the server is a **remote Streamable HTTP MCP server**:

```json
{
  "mcpServers": {
    "agentpay": {
      "url": "https://agentpay-yuno.vercel.app/mcp"
    }
  }
}
```

Clients that only speak stdio can bridge to it:

```json
{
  "mcpServers": {
    "agentpay": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://agentpay-yuno.vercel.app/mcp"]
    }
  }
}
```

Running locally instead of production? Swap the host for `http://localhost:3210/mcp`.

<br>

### 🔑 What the authentication actually does

AgentPay never hands your assistant a long-lived key. It runs a full **OAuth 2.1 authorization-code flow with PKCE**, and the client discovers everything it needs on its own:

```
  1. Agent  →  POST https://agentpay-yuno.vercel.app/mcp
     AgentPay ← 401 + WWW-Authenticate pointing at the resource metadata

  2. Agent  →  GET  /.well-known/oauth-protected-resource/mcp
     {
       "resource":              "https://agentpay-yuno.vercel.app/mcp",
       "authorization_servers": ["https://oieakzvyonhoddqukmse.supabase.co/auth/v1"],
       "scopes_supported":      ["email"],
       "bearer_methods_supported": ["header"],
       "resource_documentation": "https://agentpay-yuno.vercel.app/connect"
     }

  3. Agent  →  GET  <authorization server>/.well-known/oauth-authorization-server
               Dynamic client registration — the agent registers itself, no
               manual client ID needed.

  4. Browser opens the AgentPay consent screen  (/oauth/consent)
               ├─ Not signed in?      Sign in or create the account inline
               ├─ No passkey yet?     Create it inline
               └─ Approve / Deny the named client

  5. Agent  ←  Authorization code  →  access token (scope: email)

  6. Every MCP call:   Authorization: Bearer <token>
     AgentPay verifies the token with Supabase on EVERY request and resolves
     it to exactly one user id. Row Level Security does the rest.
```

**What this buys you:**

- 🔐 The agent's token is scoped to *your* account only. Row Level Security in Postgres means one user's token physically cannot read another user's cards, mandates or attempts.
- 👤 **Consent is a real screen**, not a checkbox in a config file. You see which client is asking, by name, and you can deny it.
- ✍️ The consent screen refuses to finish until you have a passkey — so an agent can never be connected to an account that has no way to authorize anything.
- 🧾 Every connected client appears on `/connect` under **Connected agents**, resolved to a recognisable name and logo.

> **Connecting an agent grants it exactly zero spending power.** It can look at your account and *ask*. Nothing more. Money requires a mandate you signed.

---

## Step 7 · Ask your agent to buy something 🛒

Now just talk to it. **Give it the store URL** — AgentPay is not a store directory, so the link comes from you or from the agent's own web search.

> *"Buy 4 standard tires from https://agentpay-yuno.vercel.app/stores/mrc_abc123 — nothing premium, and don't spend more than $1,600 per purchase."*

### 🏪 Need a store to test with?

AgentPay does not host a storefront on its own domain — production stores live on their own domains. Spin up a **hosted test store** in about a minute:

```
1.  Open  https://agentpay-yuno.vercel.app/developers/merchants/new
2.  Create a TEST merchant. AgentPay assigns an immutable id like  mrc_abc123
3.  Add a couple of products in the console
4.  You now have four working URLs:

    Storefront   https://agentpay-yuno.vercel.app/stores/mrc_abc123
    Manifest     https://agentpay-yuno.vercel.app/api/stores/mrc_abc123/agentpay.json
    Checkout     https://agentpay-yuno.vercel.app/api/stores/mrc_abc123/checkout
    Catalog API  https://agentpay-yuno.vercel.app/api/v1/merchants/mrc_abc123/products

5.  Hand the storefront URL to your agent.
```

Test stores work when you share the exact URL, but they are **never publicly listed** and must never be presented as real merchants.

### What the agent does next

| # | The agent calls | What happens |
|---|---|---|
| 1 | `get_account` | Reads your verification state, saved cards and existing mandates. Gets back **one** `next_step` telling it exactly what to do. |
| 2 | `find_products` | Fetches the store's **own** `/.well-known/agentpay.json`, then the catalog endpoint that manifest advertises. Returns the exact `mrc_…` merchant id, the store's real category slugs, its currency, and product ids with prices in cents. |
| 3 | `create_mandate` | Builds a **draft** using those exact values and your stated limits, and returns an `authorization_url` for you. |

### 🧠 Why `find_products` exists

The agent is **structurally forbidden from guessing**. Not "discouraged" — forbidden. It cannot invent a merchant id from a domain name, or a product id from a URL slug, or a category from a page heading. Every one of those values must come back from the store's own machine-readable catalog first.

That kills the most common agentic-commerce failure mode: an agent confidently hallucinating a SKU and buying the wrong thing. And a category the store does not sell is **rejected at mandate-creation time — before you are ever asked to sign** — instead of failing mysteriously at checkout.

> **AgentPay is not a store directory.** It never ranks, indexes or recommends merchants. The store URL comes from *you* or from the agent's normal web search. Discovery is the store's own document, on the store's own domain.

---

## Step 8 · Sign the mandate ✍️

Your agent gives you a link. Open it — on your phone, or by scanning the QR from the desktop app.

You land on the **mobile signing sheet** (`/m/mandates/<id>`), which shows in plain language:

```
┌──────────────────────────────────────────────┐
│  Claude is asking to buy for you             │
│                                              │
│  "Restock 4 standard tires for the fleet     │
│   before Monday — AutoParts only, nothing    │
│   premium."                        ← your words, quoted back
│                                              │
│  Per purchase      Up to $1,600.00           │
│  This month        $1,600.00, 1 purchase     │
│  Scope             tires at AutoParts        │
│  Expires           in 7 days                 │
│  Charges           💳 Visa ···· 4242         │
│                                              │
│  [ Change card ]                             │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │   ✍️  Approve with Face ID             │  │
│  └────────────────────────────────────────┘  │
│              Decline                         │
└──────────────────────────────────────────────┘
```

**Before you sign, check three things:**

1. **The description is yours.** Your original request is quoted back verbatim. If it does not match what you asked for, decline.
2. **The scope is narrow.** One store, the categories you meant — not "everything, everywhere".
3. **The card is right.** Tap **Change card** to switch to any other saved card *before* signing. The card you pick is part of what you sign.

Then approve with Face ID / Touch ID.

> 🚫 **You cannot create a mandate yourself.** There is no "new mandate" form anywhere in the web app. That is a deliberate design decision: **a mandate exists only because an agent asked for one, in response to something you said.** It can never be pre-loaded, defaulted, or quietly widened later.

**What signing actually does:** your passkey signs the canonical mandate. The registry co-signs it and flips it to `active` — but only if your latest Didit decision is still approved and your entity is not flagged or blocked. From that instant, a signed mandate is **immutable**. Nobody, including you, can edit it in place. Changing it means signing a replacement (see below).

---

## Step 9 · Watch the purchase go through ✅

Your agent now runs two calls:

**`check_purchase`** — a dry run. Same policy engine, same live mandate, but it contacts no merchant and records nothing. It answers "would this be approved?" for free, leaving no trace of a purchase that never happened.

**`purchase`** — the real one:

```
  Agent      →  signs the checkout request with its own key
  Store SDK  →  verifies the agent signature
             →  verifies the registry's signature over the mandate
             →  fetches LIVE mandate status from the registry
             →  checks the nonce (replay protection)
             →  checks its own policy
  Registry   →  final ATOMIC decision under a per-mandate lock
             →  mints a mock single-use payment token bound to your card id
```

You get one of three answers:

| Result | What it means | What the agent does next |
|---|---|---|
| 🟢 **approved** | Inside scope and limits, merchant verified. Done. | Reports the order to you. |
| 🟡 **escalated** | Price exceeds your per-purchase limit. **Nothing was charged.** | Sends you an `approval_url`. You approve *that one purchase* with your passkey. Then it retries with the `exception_id`. Your mandate is untouched. |
| 🔴 **refused** | A rule said no. | Reads the `explanation`, `remedy` and `next_tool` it was handed, and follows them. |

### Every refusal comes with instructions

AgentPay never returns a bare error code. Every decision carries a plain-English explanation, the exact remedy, and the literal name of the next tool to call:

| Reason | What the agent is told to do |
|---|---|
| `MERCHANT_NOT_IN_SCOPE` | Call `amend_mandate` with this store's URL. **Never revoke.** |
| `CATEGORY_NOT_IN_SCOPE` | Call `amend_mandate` adding that category. |
| `AMOUNT_EXCEEDS_LIMIT` | Send the user the one-time `approval_url`, then retry with `exception_id`. |
| `CUMULATIVE_EXCEEDED` | Find a cheaper product, or amend the monthly total. |
| `USES_EXCEEDED` | Only if the user wants more: amend `max_uses`. |
| `PRODUCT_NOT_FOUND` | Call `find_products` and use the id verbatim. It guessed. |
| `MANDATE_REVOKED` | **Stop.** Do not retry, do not propose a replacement. |
| `IDENTITY_VERIFICATION_REQUIRED` | Send the user to `/account` and wait. |

### 🔁 Widening scope: amend, never revoke-and-recreate

If your mandate covers `tires` and the agent needs `accessories`, the correct move is **`amend_mandate`** — never "revoke and make a new one".

- An **unsigned draft** is edited in place.
- A **signed mandate is immutable**, so an amendment becomes a *replacement draft* carrying everything forward plus the change. You sign it **once**, and that same signature retires the old mandate at that exact moment.

**You are never left holding two live mandates for the same job, and never left with a gap where neither is valid.**

---

## Step 10 · Stop it 🛑

Three ways, all immediate:

| Where | How |
|---|---|
| 💬 **Tell your agent** | "Stop buying." It calls `revoke_mandate` right away. |
| 📱 **Your phone** | Open `/m`, tap the mandate, hit the kill switch. |
| 💻 **Desktop** | `/dashboard` → the mandate → revoke. |

**Revocation is final and it wins races.** A checkout already in flight does one last live registry check before settlement. If your revocation committed first, that checkout is refused with `MANDATE_REVOKED` and no token is minted — *even though the purchase started before you hit the button.*

That works because checkout settlement and revocation take the **same per-mandate database lock**. Under concurrency there is exactly one defensible order, and it is decided in Postgres, not in application code that could race.

> 🔑 **The single most important design point:** live status lives in the registry, never inside the token. There is no cached grant to outrun, no signed artefact that stays valid after you say stop.

---

## Where everything lives 🗺️

| Screen | What you do there |
|---|---|
| **`/`** | Landing page — what AgentPay does, and where merchants start |
| **`/dashboard`** | Your home base: charged this month, active mandates, what is waiting for your signature |
| **`/activity`** | Every purchase attempt and the exact decision made on it |
| **`/connect`** | Which assistants are connected, and how to add another |
| **`/account`** | Identity verification, compliance details, delivery address, saved cards, default card |
| **`/m`** | 📱 Phone-first signing inbox and kill switch. Open it by scanning the QR from desktop |
| **`/audit`** | Hash-chained security log of every decision — tamper-evident |
| **`/privacy`** · **`/terms`** | Privacy Policy and Terms of Service |
| **`/docs`** | Merchant documentation: put AgentPay in your own store |
| **`/developers`** | Merchant console: create merchants, hosted test stores, products, API keys |
| **`/developers/merchants/new`** | 🏪 Create a hosted test store to try the whole flow end to end |
| **`/stores/:id`** | A hosted test storefront. Shareable by exact URL, never publicly listed |

Every screen is responsive and works from a phone. `/m` is a deliberately narrower surface for the one thing you do under time pressure — signing and stopping.

---

## ❓ Common problems

| Symptom | Cause | Fix |
|---|---|---|
| **No confirmation email** | It is in spam. It is always in spam. | Open the spam folder, search `fwdco.space`, mark **Not spam**. See Step 1. |
| **"Check your email to confirm"** loops | Not confirmed yet | Confirm from the spam folder first, *then* sign in. |
| **Email never arrives, even in spam** | 30-emails-per-hour project limit, or a strict corporate filter | Wait an hour, or use a personal Gmail. |
| **Create passkey button is greyed out** | Embedded browser, or no screen lock | Open `https://agentpay-yuno.vercel.app` directly in Safari or Chrome. |
| **Passkey prompt never appears** | Wrong hostname | Passkeys are bound to the exact host. Use the canonical production URL — not an IP, not a preview deployment. |
| **Agent says it cannot sign in** | Popup blocked | Allow popups for your assistant, or copy the OAuth URL into a normal tab. |
| **Agent says "identity verification required"** | Didit not approved, or entity flagged/blocked | Go to `/account` and finish or re-run verification. |
| **Agent says "no payment method"** | No card saved | `/account` → Add payment method, or let the agent send you the setup link. |
| **Mandate stuck on "draft"** | You have not signed it | Open the `authorization_url`. A draft is a normal state, not an error. |
| **Agent created a second mandate** | It ignored the draft | Decline the duplicate. Only one draft should exist per request. |
| **Purchase refused: category not in scope** | Mandate is narrower than the product | Ask the agent to **amend** — not revoke. |
| **Purchase escalated** | Over the per-purchase limit | Approve that single purchase with your passkey. Your limits stay as you set them. |

---

# Part 2 — Under the hood

## Architecture

Full sequence diagram, trust boundaries and the enforcement path: **[docs/architecture.md](docs/architecture.md)**.

The layers:

```
┌────────────────────────────────────────────────────────────────────┐
│  AGENT           Claude · ChatGPT · Gemini · OpenClaw · any MCP     │
├────────────────────────────────────────────────────────────────────┤
│  TRANSPORT       OAuth 2.1 + PKCE · dynamic client registration     │
│                  Streamable HTTP MCP at /mcp                        │
├────────────────────────────────────────────────────────────────────┤
│  IDENTITY        Supabase Auth (sessions, OAuth grants)             │
│                  WebAuthn passkeys (approval)                       │
│                  Didit hosted KYC (identity + fraud)                │
├────────────────────────────────────────────────────────────────────┤
│  AUTHORITY       Signed mandates · scope · limits · validity        │
│                  Registry: canonical signing + live status          │
├────────────────────────────────────────────────────────────────────┤
│  ENFORCEMENT     Policy engine · atomic per-mandate lock            │
│                  DB trigger gate · hash-chained audit log           │
├────────────────────────────────────────────────────────────────────┤
│  MERCHANT        Store-owned /.well-known/agentpay.json             │
│                  Catalog endpoint · verified checkout               │
│                  @agentpay/merchant-sdk                             │
└────────────────────────────────────────────────────────────────────┘
```

All prices, mandate limits, attempts and mock payment allowances are **USD integer cents**. No component performs FX conversion; a currency mismatch is refused before payment.

## MCP tools

The working order is:

```
get_account → find_products → create_mandate → get_mandate → check_purchase → purchase
                                    ↓                              ↓
                              amend_mandate                  revoke_mandate
                          (fix scope/limits)              (only when told to stop)
```

Every tool returns its data both as `structuredContent` **and** as JSON text, so a model that only reads `content` still sees the ids it was handed.

| Tool | Key inputs | Returns |
|---|---|---|
| **`get_account`** | — | Identity-verification state, order profile, saved cards with usage, every mandate with status and a one-line summary, pending approvals, and a single `next_step` |
| **`get_payment_setup_link`** | — | A 15-minute, user-bound browser link. **Accepts no card data.** |
| **`find_products`** | `merchant_url`, `query?`, `category?`, `max_price_cents?`, `limit?` | Exact merchant id, category slugs, currency, product ids and prices in cents, plus a `mandate_hint` ready for `create_mandate` |
| **`create_mandate`** | `merchant_urls` *(preferred)* or `merchant_ids`, `categories`, `per_purchase_cents`, `cumulative_cents?`, `max_uses?`, `expires_in_days?`, `vault_card_id?`, `natural_language_description?` | Draft mandate + `authorization_url`. Defaults: `max_uses` 1, expiry 7 days, account default card, `cumulative_cents` = `per_purchase_cents × max_uses` |
| **`amend_mandate`** | `mandate_id`, `add_merchant_urls?`, `add_categories?`, new limits/expiry | Draft edited in place, or a replacement draft that revokes the old mandate the moment it is signed |
| **`get_mandate`** | `mandate_id` | Live status, remaining uses, remaining budget, next step. `draft` is a state, not an error |
| **`check_purchase`** | `mandate_id`, `merchant_url`, `product_id` | Dry run: `would_be` + explanation. No merchant contact, no attempt recorded |
| **`purchase`** | `mandate_id`, `merchant_url`, `product_id`, `exception_id?` | Signed merchant checkout + final atomic registry decision. `escalated` carries `approval_url` and `retry_with`; `refused` carries `explanation`, `remedy`, `next_tool` |
| **`revoke_mandate`** | `mandate_id` | Final. For the user saying stop — **never** for fixing scope |

The MCP server ships **operating instructions** in its handshake (`app/mcp/route.ts`), so a fresh model gets the call order, the meaning of each decision, and the amend-don't-revoke rule before it makes its first mistake.

Protected-resource metadata: `/.well-known/oauth-protected-resource/mcp`. Supabase publishes the OAuth authorization-server metadata and supports dynamic client registration.

Full flow with example payloads: **[`/docs/agents`](https://agentpay-yuno.vercel.app/docs/agents)**.

## Merchant SDK

A store signs in at [`/developers`](https://agentpay-yuno.vercel.app/developers) and creates a merchant. AgentPay assigns the **immutable merchant ID** used in mandates — developers no longer invent one in configuration. A hosted test merchant immediately gets a working storefront, sample catalog, discovery manifest, checkout endpoint and server-side catalog API key. **Production storefronts live on their own domains and repositories, never on the AgentPay service domain.**

For a merchant id such as `mrc_abc123`, the console produces:

```
Storefront   https://agentpay-yuno.vercel.app/stores/mrc_abc123
Manifest     https://agentpay-yuno.vercel.app/api/stores/mrc_abc123/agentpay.json
Checkout     https://agentpay-yuno.vercel.app/api/stores/mrc_abc123/checkout
Catalog API  https://agentpay-yuno.vercel.app/api/v1/merchants/mrc_abc123/products
```

A live store integrates three routes:

1. **A discovery manifest** at `/.well-known/agentpay.json`
2. **A catalog endpoint** built with `createAgentPayCatalogHandler`, so agents query exact ids, categories and prices instead of scraping rendered pages
3. **A verified checkout endpoint**

The catalog is optional: every manifest field added in SDK 0.2.0 is optional, so a store still on 0.1.0 is discovered fine.

```bash
npm run sdk:install -- ../my-store   # build, pack, vendor and install in one step
npm run sdk:build                    # build only
npm run sdk:pack                     # build + tarball
```

`sdk:install` copies the tarball into `my-store/vendor/` and installs from there, so the dependency is a relative path the store can commit.

The complete integration guide is the docs site at [`/docs`](https://agentpay-yuno.vercel.app/docs) — quickstart, installation, discovery, checkout, framework recipes, testing, SDK and protocol reference, troubleshooting, **and a comprehensive prompt merchants can paste into a coding agent** to implement and test the integration in their own store. [docs/merchant-sdk.md](docs/merchant-sdk.md) is the short version for repository readers.

The supported live-store endpoint is [`/api/stores`](https://agentpay-yuno.vercel.app/api/stores). It intentionally returns **no stores** until a real HTTPS merchant completes discovery verification and explicitly opts into public listing. Hosted mocks stay unlisted test fixtures.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3210 for the landing page, or http://localhost:3210/dashboard for the app. A new account starts empty: **nothing can be charged until an agent requests a mandate and you sign it.**

Localhost is a WebAuthn secure context, so passkeys work there. On a phone, open the canonical production HTTPS URL directly in Safari or Chrome — passkeys are bound to that exact hostname, and embedded browsers may not expose the device authenticator. `npm run tunnel` gives you an HTTPS tunnel if you need a phone against local code.

### Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable key; the merchant console uses it for authenticated, RLS-protected developer work |
| `SUPABASE_SECRET_KEY` | **server only** | Used by the authenticated Didit callback and signed webhook handler. Legacy `SUPABASE_SERVICE_ROLE_KEY` still accepted as a fallback |
| `DIDIT_API_KEY` | **server only** | Didit v3 API credential |
| `DIDIT_WEBHOOK_SECRET` | **server only** | Didit webhook destination secret (HMAC verification) |
| `MERCHANT_VERIFICATION_SECRET` | **server only** | Proof required to record a live-merchant verification result. Generate with `openssl rand -hex 32`; must match the hashed Supabase configuration |
| `AGENTPAY_BASE_URL` | server | Canonical origin |
| `AGENTPAY_RP_ID` / `AGENTPAY_RP_ORIGIN` / `AGENTPAY_RP_NAME` | server | WebAuthn relying party. **`RP_ID` must exactly match the canonical hostname** |
| `AGENTPAY_ENCRYPTION_KEY` | **server only** | 32-byte base64 key for mock-vault references |
| `AGENTPAY_REGISTRY_PRIVATE_KEY` / `_PUBLIC_KEY` | server | Ed25519 keypair the registry uses to sign canonical mandates |
| `RESEND_API_KEY` | **server only** | Only for the local Supabase Auth stack; production keeps it in Supabase SMTP settings |

> ⚠️ **Never prefix a server-only secret with `NEXT_PUBLIC_`.** That publishes it into the browser bundle.

**Didit specifics:** AgentPay pins Didit's public `Free KYC` workflow ID (`51f322cc-7a71-4259-a8e2-015fd7017ca9`) in server code and sends it with every session request. Keep paid add-ons such as White Label **disabled** — the core checks use the monthly free allowance, but a paid add-on makes session creation require a cash balance. Configure the v3 webhook destination as `https://<agentpay-host>/api/webhooks/didit`, version `v3`, subscribed to `status.updated`, `data.updated`, `user.status.updated` and `user.data.updated`.

**Email:** hosted Supabase Auth delivers transactional email through Resend from `AgentPay <auth@fwdco.space>`, capped at 30 per hour. This is why confirmations land in spam and why bulk sign-ups during a demo can stall. It is entirely separate from the mocked payment rail. Running the local Supabase stack? Set `RESEND_API_KEY` in your shell before `supabase start`, and never commit it.

## Verify

```bash
npm run check      # typecheck + policy/SDK tests + installable SDK build
npm run build
npm run sdk:pack
```

Authenticated live MCP smoke test against a running deployment:

```bash
npm run test:mcp -- user@example.com 'password'
```

### Verifying mid-turn revocation

The automated Mandate API test starts a payment authorization, revokes the mandate **while that authorization is in flight**, then asserts the authorization is voided and no usage was recorded. The deployed checkout route also accepts a bounded, test-only pre-settlement window so you can rehearse the failure live.

The delay is only a test affordance. The real security boundary is the final Supabase transaction: checkout and revocation take the same per-mandate advisory lock, so their outcome has exactly one defensible order under concurrency.

## Supabase

Schema changes are versioned in `supabase/migrations/`. Every Data API table has **Row Level Security**. User-owned cards, credentials, agents and mandates are isolated by `auth.uid()` policies; merchant checkout decisions run through narrowly scoped database functions.

Supabase Auth uses the verified `fwdco.space` domain through Resend SMTP for confirmation, recovery and security email. The SMTP credential lives only in hosted Supabase configuration (and a developer's local environment when running the local stack) — never in Vercel, never in the browser bundle.

## Documentation

| Document | What it covers |
|---|---|
| [`/docs`](https://agentpay-yuno.vercel.app/docs) (`app/(docs)/docs/**`) | Merchant-facing guide to installing and setting up the SDK in a new store |
| [docs/merchant-sdk.md](docs/merchant-sdk.md) | Repository-side summary of the same integration |
| [docs/architecture.md](docs/architecture.md) | System diagram, trust boundaries, enforcement path |
| [docs/decisions.md](docs/decisions.md) | Decision log: trade-offs, rejected alternatives, deliberate limits |
| [docs/routes.md](docs/routes.md) | Every web, MCP, API and V2-service endpoint |
| [public/llms.txt](public/llms.txt) | Agent-readable summary of the public surfaces |

The docs site is part of the application, so it deploys with the code it documents. `components/docs/nav.ts` is the single source of truth for the sidebar, search index, page metadata and sitemap entries — a new page is one entry there plus one `page.tsx`.

**Documentation is updated in the same pull request as the code it describes.** `AGENTS.md` carries the table of what to update when; a pull request that changes behaviour without updating documentation is treated as unfinished.

Public crawlers receive only the canonical HTML surfaces in `/sitemap.xml`, docs site included. Protocol and authenticated paths are excluded through `/robots.txt`.

---

## What is real and what is mocked

**The payment rail is the only mocked boundary**, and the mock token is minted only *after* the real authorization and enforcement path has already succeeded, bound to the card id inside the signed mandate.

| ✅ Fully functional | 🎭 Mocked |
|---|---|
| Supabase Auth, OAuth 2.1 + PKCE, dynamic client registration | Card capture (brand, last 4, label, encrypted vault reference — no PAN anywhere) |
| WebAuthn passkey registration and signing ceremonies | Payment token issuance (single-use, mock) |
| Didit hosted identity + fraud verification, HMAC webhooks | |
| Ed25519 canonical mandate signing and registry verification | |
| The policy engine, atomic settlement, live revocation | |
| MCP server, tools, OAuth-protected transport | |
| Merchant SDK signature, nonce and live-status verification | |
| Row Level Security, database gate triggers, hash-chained audit log | |
