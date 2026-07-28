const puppeteer = require("puppeteer-core");
const fs = require("fs");

async function api(path, opts = {}, token) {
  const res = await fetch(`http://localhost:3000${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const tag = Date.now();
  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: `Tab Align Shop ${tag}`,
      subdomain: `tab-align-${tag}`,
      email: `tab-align-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Tab Align Bot",
    }),
  });

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((a, r) => {
      localStorage.setItem("requital_admin_access_token", a);
      localStorage.setItem("requital_admin_refresh_token", r);
    }, signup.accessToken, signup.refreshToken);
    fs.mkdirSync("./out", { recursive: true });

    const routes = [
      ["/inventory", "Products"],
      ["/inventory/categories", "Categories"],
      ["/inventory/movements", "Movement History"],
    ];
    const positions = {};

    for (const [path, label] of routes) {
      await page.goto(`http://localhost:3001${path}`, { waitUntil: "networkidle0", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 500));
      const rect = await page.evaluate((linkLabel) => {
        const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === linkLabel);
        if (!link) return null;
        const tabBar = link.closest("div");
        const r = tabBar.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }, label);
      positions[label] = rect;
      console.log(`${label}: tab bar top=${rect.top}, bottom=${rect.bottom}`);
    }

    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/tabs-products.png", clip: { x: 0, y: 0, width: 1440, height: 300 } });
    await page.goto("http://localhost:3001/inventory/categories", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/tabs-categories.png", clip: { x: 0, y: 0, width: 1440, height: 300 } });
    await page.goto("http://localhost:3001/inventory/movements", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/tabs-movements.png", clip: { x: 0, y: 0, width: 1440, height: 300 } });

    const tops = Object.values(positions).map((p) => p.top);
    const allSame = tops.every((t) => t === tops[0]);
    console.log("All tab-bar top positions identical:", allSame, JSON.stringify(tops));
    if (!allSame) {
      console.log("FAIL: tab bar Y-position differs across tabs");
      process.exit(1);
    }
    console.log("PASS: tab bar renders at identical Y-position on all three tabs");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
