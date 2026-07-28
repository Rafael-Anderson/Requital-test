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
      shopName: `Tab Verify Shop ${tag}`,
      subdomain: `tab-verify-${tag}`,
      email: `tab-verify-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Tab Verify Bot",
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

    // Exactly the route/scenario from the bug report: land directly on
    // Movement History (not Products first), fresh navigation, no prior
    // client-side history within this app.
    await page.goto("http://localhost:3001/inventory/movements", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 700));

    const tabLabels = await page.evaluate(() => {
      const nav = Array.from(document.querySelectorAll("a")).filter((a) =>
        ["Products", "Categories", "Ingredients", "Movement History"].includes(a.textContent.trim()),
      );
      return nav.map((a) => a.textContent.trim());
    });
    console.log("Tabs found on /inventory/movements:", JSON.stringify(tabLabels));
    await page.screenshot({ path: "./out/verify-ingredients-tab-present.png" });

    if (!tabLabels.includes("Ingredients")) {
      throw new Error("FAIL: Ingredients tab not present on freshly-restarted server");
    }

    // Click it and confirm it actually navigates and renders the page.
    const clicked = await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll("a")).find((a) => a.textContent.trim() === "Ingredients");
      if (!link) return false;
      link.click();
      return true;
    });
    await page.waitForFunction(() => location.pathname === "/inventory/ingredients", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));
    const heading = await page.evaluate(() => document.querySelector("h1")?.textContent);
    console.log("Clicked Ingredients tab, landed on:", await page.url(), "heading:", heading);
    await page.screenshot({ path: "./out/verify-ingredients-tab-clicked.png" });

    if (heading !== "Ingredients") throw new Error("FAIL: clicking the tab did not render the Ingredients page");
    console.log("PASS: Ingredients tab is present and functional on the freshly-restarted dev server");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
