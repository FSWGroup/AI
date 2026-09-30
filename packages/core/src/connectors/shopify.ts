/**
 * Shopify connector.
 *
 * Two implementations behind one interface:
 *   - ShopifyFixtureConnector: reads fixtures/shopify-products.json (DEV ONLY, mode = "fixture")
 *   - ShopifyAdminConnector:   Shopify Admin GraphQL API (mode = "live"), used only when
 *                              SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN are set.
 *
 * The rest of the platform never knows which one it is talking to, but the sync job records the mode,
 * and every source_record created from a fixture run is tied to a source flagged is_fixture = true.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ShopifyVariant {
  id: string;
  sku: string | null;
  title: string;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: string | null;
  weight: number | null;
  weightUnit: string | null;
  barcode: string | null;
  selectedOptions: { name: string; value: string }[];
}

export interface ShopifyProduct {
  id: string;
  title: string;
  bodyHtml: string;
  vendor: string;
  productType: string;
  handle: string;
  status: string;
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
  onlineStoreUrl: string | null;
  variants: ShopifyVariant[];
  images: { id: string; src: string; alt: string | null }[];
  metafields: { namespace: string; key: string; value: string; type: string }[];
  collections: string[];
}

export interface ShopifyConnector {
  readonly mode: "fixture" | "live";
  readonly label: string;
  listProducts(): AsyncGenerator<ShopifyProduct>;
}

const here = dirname(fileURLToPath(import.meta.url));

export class ShopifyFixtureConnector implements ShopifyConnector {
  readonly mode = "fixture" as const;
  readonly label = "Shopify (DEV FIXTURE)";
  constructor(private readonly path = join(here, "..", "..", "fixtures", "shopify-products.json")) {}
  async *listProducts(): AsyncGenerator<ShopifyProduct> {
    const raw = JSON.parse(readFileSync(this.path, "utf8")) as { products: Record<string, unknown>[] };
    for (const p of raw.products) yield restProductToModel(p);
  }
}

/** Convert a REST-shaped product into the connector model (REST is what the fixture mimics). */
function restProductToModel(p: Record<string, unknown>): ShopifyProduct {
  const variants = (p.variants as Record<string, unknown>[]).map((v) => ({
    id: `gid://shopify/ProductVariant/${v.id}`,
    sku: (v.sku as string) || null,
    title: v.title as string,
    price: String(v.price),
    compareAtPrice: v.compare_at_price == null ? null : String(v.compare_at_price),
    inventoryQuantity: (v.inventory_quantity as number) ?? null,
    inventoryPolicy: (v.inventory_policy as string) ?? null,
    weight: (v.weight as number) ?? null,
    weightUnit: (v.weight_unit as string) ?? null,
    barcode: (v.barcode as string) || null,
    selectedOptions: [{ name: ((p.options as { name: string }[])?.[0]?.name) ?? "Title", value: v.option1 as string }],
  }));
  return {
    id: `gid://shopify/Product/${p.id}`,
    title: p.title as string,
    bodyHtml: (p.body_html as string) ?? "",
    vendor: p.vendor as string,
    productType: p.product_type as string,
    handle: p.handle as string,
    status: p.status as string,
    tags: String(p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    publishedAt: (p.published_at as string) ?? null,
    updatedAt: p.updated_at as string,
    onlineStoreUrl: `https://valveman.example.invalid/products/${p.handle}`,
    variants,
    images: ((p.images as { id: number; src: string; alt?: string }[]) ?? []).map((i) => ({ id: String(i.id), src: i.src, alt: i.alt ?? null })),
    metafields: (p.metafields as ShopifyProduct["metafields"]) ?? [],
    collections: [],
  };
}

const PRODUCTS_QUERY = `
query Products($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title descriptionHtml vendor productType handle status tags publishedAt updatedAt onlineStoreUrl
      collections(first: 20) { nodes { handle } }
      images(first: 10) { nodes { id url altText } }
      metafields(first: 50) { nodes { namespace key value type } }
      variants(first: 100) {
        nodes {
          id sku title price compareAtPrice inventoryQuantity inventoryPolicy barcode
          selectedOptions { name value }
          inventoryItem { measurement { weight { value unit } } }
        }
      }
    }
  }
}`;

export class ShopifyAdminConnector implements ShopifyConnector {
  readonly mode = "live" as const;
  readonly label: string;
  constructor(private readonly shopDomain: string, private readonly accessToken: string, private readonly apiVersion = process.env.SHOPIFY_API_VERSION ?? "2025-07") {
    this.label = `Shopify Admin API (${shopDomain})`;
  }
  async *listProducts(): AsyncGenerator<ShopifyProduct> {
    let cursor: string | null = null;
    for (;;) {
      const res = await fetch(`https://${this.shopDomain}/admin/api/${this.apiVersion}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.accessToken },
        body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { cursor } }),
      });
      if (!res.ok) throw new Error(`Shopify Admin API ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { errors?: unknown; data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Record<string, any>[] } } };
      if (json.errors) throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
      for (const n of json.data.products.nodes) {
        yield {
          id: n.id, title: n.title, bodyHtml: n.descriptionHtml ?? "", vendor: n.vendor, productType: n.productType, handle: n.handle,
          status: String(n.status).toLowerCase(), tags: n.tags ?? [], publishedAt: n.publishedAt, updatedAt: n.updatedAt, onlineStoreUrl: n.onlineStoreUrl,
          collections: (n.collections?.nodes ?? []).map((c: { handle: string }) => c.handle),
          images: (n.images?.nodes ?? []).map((i: { id: string; url: string; altText: string | null }) => ({ id: i.id, src: i.url, alt: i.altText })),
          metafields: n.metafields?.nodes ?? [],
          variants: (n.variants?.nodes ?? []).map((v: Record<string, any>) => ({
            id: v.id, sku: v.sku || null, title: v.title, price: v.price, compareAtPrice: v.compareAtPrice, inventoryQuantity: v.inventoryQuantity,
            inventoryPolicy: v.inventoryPolicy, barcode: v.barcode || null, selectedOptions: v.selectedOptions ?? [],
            weight: v.inventoryItem?.measurement?.weight?.value ?? null, weightUnit: v.inventoryItem?.measurement?.weight?.unit ?? null,
          })),
        };
      }
      if (!json.data.products.pageInfo.hasNextPage) break;
      cursor = json.data.products.pageInfo.endCursor;
    }
  }
}

export function createShopifyConnector(env = process.env): ShopifyConnector {
  if (env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_ADMIN_ACCESS_TOKEN) return new ShopifyAdminConnector(env.SHOPIFY_SHOP_DOMAIN, env.SHOPIFY_ADMIN_ACCESS_TOKEN);
  return new ShopifyFixtureConnector();
}
