# AgentPay 1.0 — Merchant Integration Contract

> **Target Audience**: SDK Contributor (`@agentic-mandates/sdk`), Store Contributor (`viniciusgorini/AutoParts`), and Integration Team.  
> **Currency Invariant**: All amounts are in integer minor units (cents) of **USD** (`$`).  
> **Crypto Invariants**: Deterministic hashing via **RFC 8785 JSON Canonicalization Scheme (JCS)**, asymmetric signatures via **ES256 (ECDSA P-256 with SHA-256)**.

---

## 1. Endpoints Overview

| Purpose | Method & Path | Caller | Responsibility |
| :--- | :--- | :--- | :--- |
| **Discovery** | `GET /.well-known/agentpay.json` | Agent / SDK | Store exposes protocol capabilities, endpoints, and currency. |
| **Catalog Search** | `POST /v1/agents-pay/search` | Agent / SDK | Store returns product offers with local categories and stock. |
| **Quote Creation** | `POST /v1/agents-pay/quotes` | Agent / SDK | Store generates an immutable, signed JWS price quote. |
| **Order Claim** | `POST /v1/agents-pay/orders/:ref/verification` | Agent / SDK | Store claims the single-use token with Mandate Authority and confirms dispatch. |

---

## 2. Endpoint Specifications

### 2.1 Decentralized Discovery
- **URL**: `GET /.well-known/agentpay.json`
- **Response (`200 OK`)**:
```json
{
  "protocol": "agentpay/1.0",
  "merchant": {
    "id": "mrc_autoparts",
    "name": "AutoParts B2B Fleet Supply"
  },
  "checkout_endpoint": "https://autoparts.example.com/v1/agents-pay/orders/verification",
  "quotes_endpoint": "https://autoparts.example.com/v1/agents-pay/quotes",
  "catalog_search_endpoint": "https://autoparts.example.com/v1/agents-pay/search",
  "capabilities": ["intent-mandates", "batch-purchasing", "live-revocation", "mock-payment"],
  "currency": "USD"
}
```

---

### 2.2 Catalog Search
- **URL**: `POST /v1/agents-pay/search`
- **Headers**: `Content-Type: application/json`
- **Request Body**:
```json
{
  "query": "tires"
}
```
- **Response (`200 OK`)**:
```json
{
  "merchantId": "mrc_autoparts",
  "offers": [
    {
      "merchantSku": "prd_tire_std",
      "merchantCategoryId": "tires",
      "name": "Standard tire set",
      "description": "4× 205/55 R16 all-season fleet tires",
      "unitAmountMinor": 154800,
      "currency": "USD",
      "availableQuantity": 20
    }
  ]
}
```

---

### 2.3 Cryptographic Quote Creation
- **URL**: `POST /v1/agents-pay/quotes`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: quote-fleet-8921`
- **Request Body**:
```json
{
  "items": [
    { "merchantSku": "prd_tire_std", "quantity": 1 }
  ],
  "metadata": {
    "vehicle_plate": "FLT-8092",
    "purchase_order": "PO-2026-089"
  }
}
```
- **Response (`201 Created`)**:
```json
{
  "quote": {
    "id": "qte_8921a",
    "merchantId": "mrc_autoparts",
    "merchantOrderRef": "order_7812b",
    "issuedAt": "2026-08-30T00:00:00.000Z",
    "expiresAt": "2026-08-30T00:15:00.000Z",
    "currency": "USD",
    "subtotalMinor": 154800,
    "shippingMinor": 2500,
    "taxMinor": 7865,
    "totalMinor": 165165,
    "lineItems": [
      {
        "merchantSku": "prd_tire_std",
        "merchantCategoryId": "tires",
        "name": "Standard tire set",
        "unitAmountMinor": 154800,
        "quantity": 1,
        "totalMinor": 154800
      }
    ],
    "keyId": "autoparts-2026-08",
    "signature": "eyJhbGciOiJFUzI1NiIsImtpZCI6ImF1dG9wYXJ0cy0yMDI2LTA4In0..."
  }
}
```

---

### 2.4 Order Verification & Settlement Claim
- **URL**: `POST /v1/agents-pay/orders/{merchantOrderRef}/verification`
- **Headers**:
  - `Content-Type: application/json`
  - `Idempotency-Key: verify-order-7812b`
- **Request Body**:
```json
{
  "quoteId": "qte_8921a",
  "paymentToken": "vt_mock_98a72b",
  "mandateId": "mnd_7f2a"
}
```
- **Response (`200 OK`)**:
```json
{
  "ok": true,
  "order": {
    "ref": "order_7812b",
    "status": "confirmed",
    "invoice_number": "INV-2026-089",
    "total_cents": 165165,
    "currency": "USD",
    "estimated_dispatch": "2026-08-30T08:00:00.000Z"
  }
}
```

---

## 3. Standard Reason & Error Codes

| Code | HTTP Status | Description |
| :--- | :--- | :--- |
| `UNMAPPED_CATEGORY` | `403 Forbidden` | The local merchant category does not map to an authorized canonical category in the mandate. |
| `MANDATE_REVOKED` | `403 Forbidden` | The mandate has been revoked in real time by the principal. |
| `AMOUNT_EXCEEDS_LIMIT` | `403 Forbidden` | Total quote amount exceeds the per-purchase or cumulative mandate budget. |
| `MERCHANT_NOT_IN_SCOPE`| `403 Forbidden` | The merchant ID is not permitted under the active mandate scope. |
| `SIGNATURE_INVALID` | `401 Unauthorized`| The ES256 JWS signature or agent request proof failed cryptographic validation. |
