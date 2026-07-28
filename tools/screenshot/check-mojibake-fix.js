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
      shopName: `Mojibake Fix Shop ${tag}`,
      subdomain: `mojibake-fix-${tag}`,
      email: `mojibake-fix-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Mojibake Fix Bot",
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

    await page.goto("http://localhost:3001/inventory/ingredients", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    const captionText = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll("p")).find((el) => el.textContent.includes("Raw materials"));
      return p ? p.textContent : null;
    });
    console.log("Rendered caption:", JSON.stringify(captionText));
    await page.screenshot({ path: "./out/mojibake-fixed-ingredients.png", clip: { x: 0, y: 0, width: 900, height: 300 } });

    const hasMojibake = /â€|Â[^\w\s]/.test(captionText || "");
    const hasEmDash = (captionText || "").includes("\u2014");
    console.log("Contains mojibake:", hasMojibake);
    console.log("Contains proper em dash:", hasEmDash);
    if (hasMojibake || !hasEmDash) {
      console.log("FAIL: mojibake still present or em dash missing");
      process.exit(1);
    }
    console.log("PASS: caption renders with a proper em dash, no mojibake");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
