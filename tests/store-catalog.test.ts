import { describe, expect, it } from "vitest";

import { GET, OPTIONS } from "@/app/api/store/catalog/route";

describe("AutoParts machine catalog", () => {
  it("publishes the exact product IDs accepted by merchant checkout", async () => {
    const response = await GET(
      new Request("https://autoparts.example/api/store/catalog"),
    );
    const catalog = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(catalog).toMatchObject({
      protocol: "agentpay-catalog/1.0",
      merchant: { id: "mrc_autoparts", name: "AutoParts" },
    });
    expect(catalog.products).toHaveLength(4);
    expect(catalog.products).toContainEqual(
      expect.objectContaining({
        product_id: "prd_tire_std",
        merchant_id: "mrc_autoparts",
        category: "tires",
        price_cents: 154_800,
        currency: "BRL",
        availability: "in_stock",
      }),
    );
  });

  it("supports cross-origin preflight", async () => {
    const response = await OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
