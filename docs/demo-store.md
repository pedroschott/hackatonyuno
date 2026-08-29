# Demo store

`src/demo-store/index.html` is a fictional beauty storefront used as a test fixture for payment
automation. It is a single self-contained HTML file: no build step, no dependencies, no backend.
Open it directly in a browser or serve the folder with any static server.

```bash
python -m http.server 8000 --directory src/demo-store
```

Nothing is sent anywhere. Payments are simulated in the browser and a banner at the top of the page
states that no real data is processed.

## What it covers

- Catalog of 16 products across five categories, with search, category filters and sorting
- Product modal with size variants, quantity stepper and installment preview
- Cart drawer with quantity changes, removal, coupons and a free-shipping progress note
- Three-step checkout: delivery details, shipping method, payment
- Shipping calculated from the postal code, with a distance factor per region
- Payment methods: credit card (up to 6 installments), Pix (5% off), bank slip
- Order confirmation with order number and receipt breakdown
- Cart, coupon and delivery details persist in `localStorage` under `mare-demo-store`

The interface is in English, per `AGENTS.md`. The commerce rules stay Brazilian — CEP, CPF, Pix and
BRL — because that is what the payment flow under test exercises. Amounts are formatted as
`R$ 1,234.56`.

## Test data

| What | Value |
| --- | --- |
| Card number | `4242 4242 4242 4242` (any future expiry, any 3-digit CVV) |
| Coupon `AGENTPAY10` | 10% off |
| Coupon `MARE20` | 20% off on carts over R$ 300 |
| Coupon `FREESHIP` | free standard shipping |
| Free standard shipping | automatic over R$ 249 |
| Postal code | any 8 digits; the first digit sets the region factor and the estimate |

The delivery step has a **Fill with test data** button that populates a valid São Paulo address.

## Automation hooks

Stable `data-testid` attributes on every element the flow needs:

`demo-banner`, `menu-toggle`, `search-input`, `open-cart`, `cart-count`, `product-grid`,
`product-card`, `product-name`, `product-price`, `add-to-cart`, `product-modal`,
`modal-add-to-cart`, `cart-drawer`, `cart-item`, `item-qty`, `coupon-input`, `apply-coupon`,
`cart-subtotal`, `cart-total`, `go-to-checkout`, `checkout`, `checkout-steps`, `fill-test-data`,
`continue-to-shipping`, `shipping-option`, `continue-to-payment`, `pay-card`, `pay-pix`,
`pay-boleto`, `place-order`, `order-summary`, `checkout-total`, `order-confirmation`, `order-id`,
`order-total`.

Form fields carry matching `id`, `name` and `autocomplete` values: `name`, `email`, `phone`,
`tax-id`, `postal-code`, `street`, `number`, `complement`, `district`, `city`, `state`,
`card-number`, `card-name`, `card-expiry`, `card-cvv`, `installments`.

### `window.AgentPayDemo`

| Method | Returns |
| --- | --- |
| `products()` | catalog as `{id, name, category, price}` |
| `cart()` | current cart lines |
| `totals()` | `{subtotal, discount, shipping, total, items}` |
| `addItem(id, qty)` | adds a product to the cart |
| `applyCoupon(code)` | applies a discount code |
| `openCheckout()` | opens the checkout overlay |
| `order()` | the placed order, or `null` |
| `clear()` | empties cart, coupon and shipping choice |
| `state()` | deep copy of the internal state |

### Events

Dispatched on `document`, all prefixed with `agentpay:` — `cart-updated`, `coupon-applied`,
`product-opened`, `checkout-opened`, `checkout-step`, `shipping-selected`, `order-placed`. The
`order-placed` detail carries the full order, including `id`, `total`, `payment` and `products`.

## Verification

The full path was exercised in a browser: add to cart → apply `AGENTPAY10` → submit the delivery
step empty (10 fields flagged, step held) → fill test data → express shipping → switch to Pix and
back to card → pay with the test card. The order was created with the cart cleared and the
confirmation rendered. Light and dark themes were both checked.
