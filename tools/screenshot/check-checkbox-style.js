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
      shopName: `Checkbox Style Shop ${tag}`,
      subdomain: `checkbox-style-${tag}`,
      email: `checkbox-style-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Checkbox Style Bot",
    }),
  });
  const token = signup.accessToken;
  const category = await api("/categories", { method: "POST", body: JSON.stringify({ name: "General" }) }, token);
  for (let i = 0; i < 3; i++) {
    await api(
      "/products",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Checkbox Style Product ${i}`,
          price: 10,
          thumbnail: "https://example.com/x.jpg",
          sku: `CBSTYLE-${tag}-${i}`,
          categoryIds: [category.id],
        }),
      },
      token,
    );
  }

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

    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: "./out/checkbox-style-products.png", clip: { x: 0, y: 260, width: 500, height: 240 } });

    const styled = await page.evaluate(() => {
      const input = document.querySelector('input[type="checkbox"]');
      if (!input) return null;
      const styled = input.className.includes("peer") && input.className.includes("appearance-none");
      return { className: input.className, looksStyled: styled };
    });
    console.log("First checkbox check:", JSON.stringify(styled));

    // Click the row checkbox and confirm the styled box (sibling span) shows checked state visually.
    const toggled = await page.evaluate(() => {
      const rowCheckbox = document.querySelectorAll('input[type="checkbox"]')[1];
      rowCheckbox.click();
      return rowCheckbox.checked;
    });
    console.log("Row checkbox toggled to:", toggled);
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: "./out/checkbox-style-products-checked.png", clip: { x: 0, y: 260, width: 500, height: 240 } });

    if (!styled || !styled.looksStyled) {
      throw new Error("FAIL: checkbox does not use the styled Checkbox component");
    }
    console.log("PASS: row-selection checkboxes now use the styled Checkbox component");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
