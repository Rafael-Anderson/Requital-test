import { describe, expect, it, vi } from "vitest";
import type { Shop } from "@/lib/types";

const api = vi.hoisted(() => ({ getShop: vi.fn(), getThemeConfig: vi.fn() }));
vi.mock("@/lib/api", () => ({
  getShop: api.getShop,
  getThemeConfig: api.getThemeConfig,
  listOutlets: vi.fn(),
  HttpError: class extends Error {},
  resolveImageUrl: (p: string | null | undefined) => (p ? (p.startsWith("/") ? `http://api.test${p}` : p) : null),
}));
vi.mock("./ShopLayoutClient", () => ({ default: () => null }));
vi.mock("@/components/JsonLd", () => ({ default: () => null }));

import { generateMetadata } from "./layout";

const shop = {
  name: "dff",
  displayName: "Dubai Fresh Flowers",
  metaTitle: null,
  faviconUrl: null,
  logoUrl: null,
  ogImage: null,
  description: null,
  metaDescription: null,
  canonicalOrigin: null,
} as unknown as Shop;

const run = () => generateMetadata({ params: Promise.resolve({ shop: "dff" }) });

describe("[shop]/layout generateMetadata (what ends up in <head>)", () => {
  it("serves the favicon set in theme settings and uses the business name as the title", async () => {
    api.getShop.mockResolvedValue(shop);
    api.getThemeConfig.mockResolvedValue({ globalSettings: { logo: { faviconUrl: "/uploads/fav.png" } } });
    const meta = await run();
    expect(meta.icons).toEqual({ icon: "http://api.test/uploads/fav.png" });
    expect(meta.title).toEqual({ default: "Dubai Fresh Flowers", template: "%s | Dubai Fresh Flowers" });
  });

  it("falls back to the logo when no favicon is set, and to no icon when there is neither", async () => {
    api.getShop.mockResolvedValue({ ...shop, logoUrl: "/uploads/logo.png" });
    api.getThemeConfig.mockResolvedValue(null);
    expect((await run()).icons).toEqual({ icon: "http://api.test/uploads/logo.png" });
    api.getShop.mockResolvedValue(shop);
    expect((await run()).icons).toBeUndefined();
  });

  it("a theme fetch failure never loses the title or the shop favicon", async () => {
    api.getShop.mockResolvedValue({ ...shop, faviconUrl: "/uploads/legacy.png" });
    api.getThemeConfig.mockRejectedValue(new Error("down"));
    const meta = await run();
    expect(meta.icons).toEqual({ icon: "http://api.test/uploads/legacy.png" });
  });

  it("an unreachable shop never titles the tab with the slug/domain", async () => {
    api.getShop.mockRejectedValue(new Error("down"));
    expect((await run()).title).toBe("Online store");
  });
});
