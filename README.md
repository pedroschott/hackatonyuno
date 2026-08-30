# AgentPay

![AgentPay logo](public/agentpay-logo.png)

**Your AI assistant can now buy things. AgentPay is the layer that decides what it is allowed to buy — and enforces it.**

An agent connects to AgentPay through an OAuth-protected MCP server. It can *ask* for spending authority, but it can never grant itself any. You sign a narrow, time-boxed **mandate** with your passkey, and every purchase is checked against that mandate at the moment of settlement. Revoke it and the very next checkout fails.

🔗 **Live:** https://agentpay-yuno.vercel.app · 🏪 **Store you can actually buy from:** https://partsroute.vercel.app · 📘 **Merchant docs:** https://agentpay-yuno.vercel.app/docs

---

## The whole idea in one picture

```
        YOU                        THE AGENT                    AGENTPAY                  PARTSROUTE
         │                             │                            │                           │
         │  "fix my squealing brakes,  │                            │                           │
         │   under $150 total"         │                            │                           │
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

> ⏱️ **Three steps, about five minutes.**
> Create an account → connect your assistant → ask it to buy something.
> Everything else — your passkey, identity verification, your card — the agent hands you at the exact moment it is needed. You do not have to set any of it up in advance.

---

## Step 1 · Create your account

1. Go to **https://agentpay-yuno.vercel.app/dashboard**
2. Click **"New to AgentPay? Create an account"**
3. Enter your email and a password of **at least 8 characters**
4. Click **Create account**

```
┌──────────────────────────────────────────────────────────────┐
│  🚨  THE CONFIRMATION EMAIL LANDS IN SPAM.  🚨                │
│                                                              │
│  It is sent from:                                            │
│                                                              │
│         AgentPay  <auth@fwdco.space>                         │
│                                                              │
│  Gmail, Outlook and iCloud all file it as spam, because      │
│  fwdco.space is a young sending domain with no reputation    │
│  history yet.                                                │
│                                                              │
│  It is annoying. There is no way around it today. Open the   │
│  spam folder, mark it "Not spam", and click the link.        │
│                                                              │
│  Nothing else works until you confirm.                       │
└──────────────────────────────────────────────────────────────┘
```

Once confirmed, come back and **sign in**.

> ⚠️ **Open AgentPay directly in Safari or Chrome.** Passkeys are bound to the exact hostname `agentpay-yuno.vercel.app`. Embedded browsers — the little in-app browser inside Slack, Instagram, LinkedIn or a QR-scanner app — often cannot reach Face ID or Touch ID, and you will get a confusing failure later at signing time.

---

## Step 2 · Connect your agent 🤖

Your connection link is always the same, and it is the *only* thing you need. No API key, no client ID, no secret to paste:

```
https://agentpay-yuno.vercel.app/mcp
```

The flow is identical in every assistant:

```
1.  Open your assistant's connector / tools settings
2.  Add a custom connector
3.  Paste   https://agentpay-yuno.vercel.app/mcp
4.  A browser window opens — sign in to AgentPay
5.  Approve the consent screen
6.  "AgentPay" now appears in your connector list
```

| Assistant | Where the setting lives |
|---|---|
| 🟠 **Claude** (web, desktop, mobile) | Settings → **Connectors** → *Add custom connector* |
| 🟢 **ChatGPT** | Settings → **Connectors** → add a connector |
| 🔵 **Gemini** | **Extensions / Tools** settings → add a connector |
| 🐾 **OpenClaw** | **Connectors / Tools** settings → add a connector |
| ⚙️ **Anything else** | Wherever it keeps MCP servers |

Already connected assistants are listed on **`/connect`**, with a picker to add another.

### Config-file clients

For clients configured by file — Claude Desktop, Cursor, a local `.mcp.json`, your own framework — this is a **remote Streamable HTTP MCP server**:

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

Running the app locally? Swap the host for `http://localhost:3210/mcp`.

### 🔑 What the authentication actually does

AgentPay never hands your assistant a long-lived key. It runs a full **OAuth 2.1 authorization-code flow with PKCE**, and the client discovers everything on its own:

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
               Dynamic client registration — the agent registers itself.
               No manual client ID anywhere.

  4. Browser opens the AgentPay consent screen  (/oauth/consent)
               ├─ Not signed in?   Sign in or create the account inline
               ├─ No passkey yet?  Create it inline — approval is blocked until you do
               └─ Approve / Deny the named client

  5. Agent  ←  Authorization code  →  access token (scope: email)

  6. Every MCP call:   Authorization: Bearer <token>
     AgentPay re-verifies the token with Supabase on EVERY request and resolves
     it to exactly one user id. Row Level Security does the rest.
```

- 🔐 The token is scoped to *your* account. RLS in Postgres means one user's token physically cannot read another user's cards, mandates or attempts.
- 👤 **Consent is a real screen**, not a config flag. You see which client is asking, by name, and you can deny it.
- ✍️ The screen refuses to finish until you have a passkey — an agent can never be attached to an account that has no way to authorize anything.

> **Connecting an agent grants it exactly zero spending power.** It can look at your account and *ask*. Nothing more. Money requires a mandate you signed.

---

## Step 3 · Make a real payment at PartsRoute 🛒

This is the actual test. Not a simulation, not a seeded fixture inside this repo — a **real, independent store on its own domain** that integrated the AgentPay merchant SDK, and a full purchase that ends in a settled decision.

### 🏪 https://partsroute.vercel.app

PartsRoute is an auto-parts store built and deployed **separately from AgentPay**, in its own repository ([`pedroschott/autoparts`](https://github.com/pedroschott/autoparts)), on its own domain. It installed `@agentpay/merchant-sdk` and published the three routes the protocol asks for. AgentPay has no special knowledge of it — it discovers PartsRoute exactly the way it would discover any other store, by reading documents PartsRoute serves itself.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🚨  PartsRoute is the ONLY store where a purchase can complete today.  🚨│
│                                                                         │
│  Point your agent at   https://partsroute.vercel.app                    │
│                                                                         │
│  AgentPay is not a store directory — it never ranks, indexes or         │
│  recommends merchants, so it cannot suggest a store for you. Any        │
│  store works the moment it integrates the SDK. PartsRoute is the one    │
│  that is live right now, so give your agent that URL.                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**What the agent finds there** — all of it published by PartsRoute, none of it stored by AgentPay:

| | |
|---|---|
| **Merchant ID** | `mrc_835dda9e14b9709870f2` — assigned by AgentPay, immutable, the value that goes into your mandate |
| **Manifest** | `https://partsroute.vercel.app/.well-known/agentpay.json` |
| **Catalog** | `https://partsroute.vercel.app/api/agentpay/catalog` |
| **Checkout** | `https://partsroute.vercel.app/api/agentpay/checkout` |
| **Product pages** | `https://partsroute.vercel.app/product/{id}` |
| **Catalog size** | 55 real products, USD |
| **Categories** | `brakes` · `cooling` · `drivetrain` · `electrical` · `engine` · `exhaust` · `filters` · `fluids` · `fuel` · `lighting` · `suspension` · `tires` |
| **Price range** | $6.40 (a spark plug) to $312.00 (a muffler) |

Curl any of it yourself — it is all public:

```bash
curl https://partsroute.vercel.app/.well-known/agentpay.json
curl 'https://partsroute.vercel.app/api/agentpay/catalog?q=brake+pad&max_price_cents=5000'
```

### 💬 Prompts to try

Copy-paste these into your assistant. **Start with #1** — the first one walks you through passkey, identity verification and card setup along the way, so everything after it is instant.

**1 · The straightforward buy**

> *"Buy a Fram oil filter from https://partsroute.vercel.app. Don't spend more than $15."*

**2 · A problem, not a product** — the one worth demoing

> *"My front brakes are squealing. Find me front rotors and ceramic pads at https://partsroute.vercel.app, keep the whole job under $150, and buy the best-value combination you find."*
>
> The agent has to search the catalog, compare real parts, decide what "best value" means, ask for a mandate wide enough to cover both purchases, and then make two separate purchases inside one budget you signed once.

**3 · A shopping list with a budget**

> *"I'm doing an oil change on Saturday. From https://partsroute.vercel.app get me synthetic 5W-30 and a good oil filter — max $40 per item, no more than 3 purchases total, and the mandate should expire in 3 days."*

**4 · Watch a refusal, then an amendment** 🔴

> *"Now also buy a gallon of coolant from the same store."*
>
> If your mandate only covered `filters`, this comes back **refused** with `CATEGORY_NOT_IN_SCOPE`. Watch the agent call **`amend_mandate`** rather than revoking — you sign the replacement once, and the old mandate retires at that exact moment.

**5 · Watch an escalation** 🟡

> *"Buy the ACDelco Group 35 battery from https://partsroute.vercel.app."*
>
> It's $164.50. If your per-purchase limit is lower, this comes back **escalated** — nothing charged, and a link to approve *that one purchase* with your passkey. Your mandate's limits stay exactly as you set them.

**6 · The kill switch** 🛑

> *"Stop buying. Revoke that mandate."*
>
> Immediate. The next checkout fails, and so does one that is already in flight.

### What the agent does behind the scenes

| # | Tool | What happens |
|---|---|---|
| 1 | `get_account` | Reads your verification state, saved cards and existing mandates. Gets **one** `next_step` back telling it exactly what to do — including sending you off to verify or add a card. |
| 2 | `find_products` | Fetches PartsRoute's own manifest, then the catalog endpoint that manifest advertises. Returns the exact merchant id, real category slugs, currency, product ids and prices in cents. |
| 3 | `create_mandate` | Builds a **draft** from those exact values plus your stated limits, and hands you an `authorization_url`. |
| 4 | `get_mandate` | Polls until you have signed. `draft` is a normal state, not an error. |
| 5 | `check_purchase` | Dry run against the live mandate. Same policy engine, no merchant contact, **nothing recorded**. |
| 6 | `purchase` | Signed checkout at PartsRoute, then the final atomic decision at the registry. |

### 🧠 Why `find_products` exists

The agent is **structurally forbidden from guessing**. Not "discouraged" — forbidden. It cannot invent a merchant id from a domain, a product id from a URL slug, or a category from a page heading. Every one of those values must come back from the store's own machine-readable catalog first.

That kills the most common agentic-commerce failure mode: an agent confidently hallucinating a SKU and buying the wrong thing. And a category the store does not sell is **rejected when the mandate is created — before you are ever asked to sign** — instead of failing mysteriously at checkout.

---

## What the agent will walk you through

The first time you run Step 3, the agent stops and hands you links. Here is what each one is, and what to check.

### 🔑 Your signing passkey

The first time you sign in, AgentPay asks for one thing before anything else:

> **Create your authorization passkey** — this is the only approval credential AgentPay needs.

Your device generates a keypair; the private key never leaves the secure enclave. AgentPay stores only the **public** credential. No password, no OTP, no shared secret that could be phished out of you or leaked from a database.

**Button greyed out?** You are in an embedded browser or on a device with no screen lock. Open `https://agentpay-yuno.vercel.app` directly in Safari or Chrome.

### 🪪 Identity verification

The agent sends you to **`/account`** → **Identity and fraud verification**. Tick the consent box, click **Verify with Didit**, photograph your ID, do the liveness selfie, and you are returned automatically.

| Badge | Meaning | What to do |
|---|---|---|
| 🟢 **Verified** | Approved, entity `ACTIVE` | Nothing. You can sign mandates. |
| 🟡 **In review** | Manual check in progress | Wait — the webhook updates you. |
| 🟡 **Needs review** | Entity came back `FLAGGED` | Purchases blocked until it clears. |
| 🔴 **Not verified** | `Declined` or `BLOCKED` | Purchases blocked. |
| ⚪ **Required** | Not started | Click **Verify with Didit**. |

This gate is real, not decoration: identity is re-checked when the mandate is signed, when the agent calls `check_purchase`/`purchase`, **and** by a database trigger that refuses to mint a payment token for an unverified, flagged or blocked account. A direct API call cannot route around it.

> 🔐 AgentPay stores only the session id, workflow, environment, decision status and entity risk state. Your documents, selfies, biometric captures and the full decision stay with Didit.

### 💳 Your payment method

If no card is saved, the agent calls `get_payment_setup_link` and gives you a **15-minute, user-bound browser link**. It does not, and cannot, collect card data in chat.

Pick a brand, type four digits (`4242` is fine), give it a label, optionally make it your default.

```
🚫  No legitimate AgentPay flow will EVER ask you to type a card number,
    CVC, PIN, bank password or vault credential into a chat window.
    If an agent asks, it is not following the protocol. Refuse.
```

> 💡 **There is no field for a real card number.** The payment rail is deliberately mocked for this challenge. AgentPay stores the brand, last four digits, a label, and an encrypted mock-vault reference. That is the entire card record.

Manage cards any time on **`/account`**: set a default, see each card's purchase count and last-used date, or remove one — removal is blocked while a card is bound to a live or pending mandate, so you cannot orphan a signed authorization.

**While you are there**, fill in **Order and compliance details** (legal name, tax ID, phone) and your **Delivery address**. Your agent reads these through your authenticated connection so it can complete a real order without interrogating you mid-purchase. They never enter a payment token or a public registry record.

### ✍️ Signing the mandate

The agent gives you a link. Open it on your phone, or scan the QR from the desktop app. You land on the mobile signing sheet (`/m/mandates/<id>`):

```
┌──────────────────────────────────────────────┐
│  Claude is asking to buy for you             │
│                                              │
│  "My front brakes are squealing — front      │
│   rotors and ceramic pads at PartsRoute,     │
│   whole job under $150."   ← your words, quoted back
│                                              │
│  Per purchase      Up to $90.00              │
│  This month        $150.00, 2 purchases      │
│  Scope             brakes at PartsRoute      │
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

**Check three things before you sign:**

1. **The description is yours.** Your original request is quoted back verbatim. If it does not match, decline.
2. **The scope is narrow.** One store, the categories you meant — not "everything, everywhere".
3. **The card is right.** Tap **Change card** to switch before signing. The card you pick is part of what you sign.

> 🚫 **You cannot create a mandate yourself.** There is no "new mandate" form anywhere in the web app. That is deliberate: **a mandate exists only because an agent asked for one, in response to something you said.** It can never be pre-loaded, defaulted, or quietly widened later.

Signing makes your passkey sign the canonical mandate. The registry co-signs and flips it to `active` — but only if your latest Didit decision still passes. From that instant the mandate is **immutable**. Nobody, including you, can edit it in place.

### ✅ Reading the decision

| Result | Meaning | What the agent does |
|---|---|---|
| 🟢 **approved** | Inside scope and limits, merchant verified. Done. | Reports the order to you. |
| 🟡 **escalated** | Over your per-purchase limit. **Nothing was charged.** | Sends you an `approval_url`. You approve *that one purchase* with your passkey; it retries with the `exception_id`. Your mandate is untouched. |
| 🔴 **refused** | A rule said no. | Reads the `explanation`, `remedy` and `next_tool` it was handed, and follows them. |

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
| `SHIPPING_ADDRESS_REQUIRED` | Send the user to `/account` to complete their delivery address. **Never ask them to dictate one in chat.** |
| `SHIPPING_ADDRESS_UNSUPPORTED` | The store does not deliver there. Nothing charged, no use spent. Retry with an address it serves. |

### 📦 Where it goes, and what it actually costs

Your agent never asks where to send a parcel. It **cannot**: the delivery address lives on your account, AgentPay hands it to the store, and an agent that had to collect one would be collecting it from whoever is in the chat — which, in a fleet, is a driver rather than the person holding the card.

If this one order goes somewhere else — the depot instead of the yard — tell your agent and it passes a one-off `ship_to`. It applies to that order only and is **never saved to your account**.

The store quotes delivery for that exact address *before* the policy runs, and your mandate is checked against the **total**:

```
$62.94 charged  =  $49.99 part  +  $12.95 ground delivery
                   ▲ what your $60 per-purchase limit used to cover
                                    ▲ what it now covers too
```

A limit that covered the sticker price and not the delivery is a limit you did not agree to. If the courier is what pushes an order over your limit, you get the same one-time approval you would get for an expensive part — and the approval is bound to that exact total, so approving a $180 delivery to the depot cannot silently authorise the same part shipped somewhere pricier.

An approved purchase reports back the method, the carrier, the estimated window and the delivery charge, so your agent can tell you when the part arrives instead of promising a confirmation email nobody sends.

### 💬 Every purchase says why

Your agent must state **why** it is buying something, in your words, on every single purchase. "The delivery van's front rotors are scored and it runs tomorrow" and "I just want it" are both complete answers. Making one up is not — the tool description says so, because a model asked for a justification will otherwise invent a plausible one.

The requirement is in the database function that settles the charge, not just in the tool description, so nothing can record a purchase without it. It sits inside the hash-chained audit entry, and it is the first thing you see three months later when you do not recognise a charge.

**Widening scope: amend, never revoke-and-recreate.** If your mandate covers `filters` and the agent needs `fluids`, the correct move is `amend_mandate`. An unsigned draft is edited in place; a **signed mandate is immutable**, so an amendment becomes a *replacement draft* carrying everything forward plus the change. You sign it **once**, and that same signature retires the old mandate at that exact moment. You are never left holding two live mandates for the same job, and never left with a gap where neither is valid.

### 🧾 Every purchase opens

Click any purchase on `/dashboard` or `/activity` and you get its **whole trail**:

- the four cryptographic checks and which one failed, if one did
- the mandate it was checked against, with that month's usage against its limits
- what you paid, split into the item and the delivery
- where it shipped, and whether that was your registered address or a one-off
- **why it was bought**, in your own words at the time
- the hash-chained log entries that name this charge, with their hashes
- a **Dispute this charge** button

Nothing there is newly stored. It is the same rows the security log holds, assembled around one purchase — because "prove nothing was edited" and "what happened with *this* charge?" are different questions, and the log was only ever shaped for the first.

### ⚖️ When a charge was allowed but still wrong

Every other rule in AgentPay is preventive: a mandate refuses what it does not cover. Revoking stops the *next* purchase and does nothing about the one that already happened.

A **dispute** is the corrective one. Open it from the purchase trail, pick what went wrong, say it in your own words. The store sees your statement **and** the reason your agent recorded when it bought the thing — which is usually the fact that settles it.

The store answers in its console, moving the case to *under review*, *evidence requested*, *refunded* or *upheld*. You can withdraw yours at any time; the store cannot withdraw it for you, and you cannot mark your own case refunded. Both sides read the same timeline.

Stores also get an **analysis** button that reads one dispute against everything else you have bought from them — including the reasons recorded at the time — and recommends refund, uphold, or ask for evidence. It is advisory and structurally cannot close a case: it writes to one field, and the status is set by a person through a different function. An LLM able to resolve disputes would be a new way to move money that nobody agreed to.

### 🛑 Stopping

Three ways, all immediate:

| Where | How |
|---|---|
| 💬 **Tell your agent** | "Stop buying." It calls `revoke_mandate` right away. |
| 📱 **Your phone** | `/m` → the mandate → kill switch. |
| 💻 **Desktop** | `/dashboard` → the mandate → revoke. |

**Revocation is final and it wins races.** A checkout already in flight does one last live registry check before settlement. If your revocation committed first, that checkout is refused with `MANDATE_REVOKED` and no token is minted — *even though the purchase started before you hit the button.*

That works because checkout settlement and revocation take the **same per-mandate database lock**. Under concurrency there is exactly one defensible order, and it is decided in Postgres, not in application code that could race.

> 🔑 **The single most important design point:** live status lives in the registry, never inside the token. There is no cached grant to outrun, no signed artefact that stays valid after you say stop.

---

## Where everything lives 🗺️

| Screen | What you do there |
|---|---|
| **`/`** | Landing page — what AgentPay does, and where merchants start |
| **`/dashboard`** | Your home base: charged this month, active mandates, what is waiting for your signature. Click any purchase for its full trail |
| **`/activity`** | Every purchase attempt and the exact decision made on it. Click one for its full trail |
| **`/connect`** | Which assistants are connected, and how to add another |
| **`/account`** | Identity verification, compliance details, delivery address, saved cards, default card |
| **`/m`** | 📱 Phone-first signing inbox and kill switch. Open it by scanning the QR from desktop |
| **`/audit`** | Hash-chained security log of every decision — tamper-evident |
| **`/privacy`** · **`/terms`** | Privacy Policy and Terms of Service |
| **`/docs`** | Merchant documentation: put AgentPay in your own store |
| **`/developers`** | Merchant console: create merchants, hosted test stores, products, API keys, transaction history and disputes |
| **`/stores/:id`** | A hosted test storefront, for merchants integrating the SDK. Shareable by exact URL, never publicly listed |

Every screen is responsive and works from a phone. `/m` is a deliberately narrower surface for the one thing you do under time pressure — signing and stopping.

---

## ❓ Common problems

| Symptom | Cause | Fix |
|---|---|---|
| **No confirmation email** | It is in spam. It is always in spam. | Open the spam folder, search `fwdco.space`, mark **Not spam**. Nothing works until you confirm. |
| **Email never arrives, even in spam** | 30-emails-per-hour project cap, or a strict corporate filter | Wait an hour, or use a personal Gmail. |
| **Create passkey button is greyed out** | Embedded browser, or no screen lock | Open `https://agentpay-yuno.vercel.app` directly in Safari or Chrome. |
| **Passkey prompt never appears** | Wrong hostname | Passkeys are bound to the exact host. Use the canonical production URL — not an IP, not a preview deployment. |
| **Agent cannot sign in** | Popup blocked | Allow popups for your assistant, or copy the OAuth URL into a normal tab. |
| **"Identity verification required"** | Didit not approved, or entity flagged/blocked | Go to `/account` and finish or re-run verification. |
| **"No payment method"** | No card saved | Open the setup link the agent gives you, or add one at `/account`. |
| **Agent says it can't find the store** | It was not given a URL | AgentPay is not a directory. Paste `https://partsroute.vercel.app` into your prompt. |
| **Mandate stuck on "draft"** | You have not signed it | Open the `authorization_url`. A draft is a normal state, not an error. |
| **Agent created a second mandate** | It ignored the existing draft | Decline the duplicate. Only one draft should exist per request. |
| **Refused: category not in scope** | Mandate is narrower than the product | Ask the agent to **amend** — not revoke. |
| **Purchase escalated** | Over the per-purchase limit | Approve that single purchase with your passkey. Your limits stay as you set them. |

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

                        search_security_log — any time, for anything that already happened
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
| **`check_purchase`** | `mandate_id`, `merchant_url`, `product_id`, `purchase_reason?`, `ship_to?` | Dry run: `would_be` + explanation, plus the address the order would go to. No merchant contact, no attempt recorded |
| **`purchase`** | `mandate_id`, `merchant_url`, `product_id`, **`purchase_reason`** *(required)*, `ship_to?`, `exception_id?` | Signed merchant checkout + final atomic registry decision. Returns `charge` (item + delivery) and `fulfillment` (method, carrier, estimated window). `escalated` carries `approval_url` and `retry_with`; `refused` carries `explanation`, `remedy`, `next_tool` |
| **`search_security_log`** | `query?`, `action?`, `attempt_id?`, `mandate_id?`, `merchant_id?`, `since?`, `until?`, `limit?` | The account's hash-chained history — mandates, purchases, approvals, disputes — with the plain-English summary the user reads on `/audit`, and the chain verification on every call |
| **`revoke_mandate`** | `mandate_id` | Final. For the user saying stop — **never** for fixing scope |

Two of those inputs are load-bearing rather than convenient. **`purchase_reason` is required** and enforced by the settlement function itself, so nothing can record a charge without saying why it happened. **`ship_to` is optional and rarely used**: orders go to the address on the account, and an agent that had to ask for one would be asking whoever is in the chat.

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

The catalog is optional, and so is delivery quoting: every manifest field added after 0.1.0 is optional, so a store still on the original three-field manifest is discovered fine.

A store on **SDK 0.3.0** can also quote delivery. `resolveFulfillment` runs before the policy, prices the order for the exact address on the request, and the mandate is then evaluated against `charge.total_cents` — the part plus the delivery — so a buyer's per-purchase limit covers what is actually charged. Returning `null` for an address the store does not serve refuses the order with `SHIPPING_ADDRESS_UNSUPPORTED` before a mandate use is consumed.

After the sale, two key-authenticated endpoints give the store the other half of the record:

```bash
# Every attempt, with the reason the buyer gave their agent and where it shipped
curl -H "authorization: Bearer $AGENTPAY_KEY" \
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/transactions?decision=approved"

# Disputes, the full context behind one, and the analysis
curl -H "authorization: Bearer $AGENTPAY_KEY" \
  "https://agentpay-yuno.vercel.app/api/v1/merchants/$MERCHANT_ID/disputes?status=open"
```

Buyers appear as a stable per-merchant pseudonym — enough to recognise a repeat customer, never an account id. See [`/docs/orders`](https://agentpay-yuno.vercel.app/docs/orders).

**PartsRoute is the reference integration.** It lives in its own repository ([`pedroschott/autoparts`](https://github.com/pedroschott/autoparts)) on its own domain, vendors the SDK tarball under `vendor/`, and serves all three routes itself. If you want to see exactly what a real store has to publish, read its live documents:

```bash
curl https://partsroute.vercel.app/.well-known/agentpay.json
curl 'https://partsroute.vercel.app/api/agentpay/catalog?category=brakes'
```

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
| `ANTHROPIC_API_KEY` | **server only** | Optional. Powers dispute analysis. Without it the console still answers: a deterministic reading runs instead and labels itself `engine: "rules"`, so the feature never silently disappears mid-demo |
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
| [`/docs/orders`](https://agentpay-yuno.vercel.app/docs/orders) | Delivery quoting, the merchant transaction API, and answering a disputed charge |
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
| Delivery quoting, the shipping charge, and the address it goes to | Nothing is physically shipped — PartsRoute is a real store's code with a real catalog, but no warehouse |
| Disputes: opening, answering, resolving, the shared timeline | Refunds are recorded as an outcome; no money moves back, because none moved out |
| Dispute analysis (Claude, with a deterministic fallback) | |
