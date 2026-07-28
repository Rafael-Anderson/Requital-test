const puppeteer = require("puppeteer-core");
const fs = require("fs");

async function main() {
  const auth = JSON.parse(fs.readFileSync("./auth.json", "utf8"));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(
      (accessToken, refreshToken) => {
        localStorage.setItem("requital_admin_access_token", accessToken);
        localStorage.setItem("requital_admin_refresh_token", refreshToken);
      },
      auth.accessToken,
      auth.refreshToken,
    );
    await page.goto("http://localhost:3001/settings/users", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    await page.click('button ::-p-text("New branch account")').catch(async () => {
      // fallback: find by text manually
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) =>
          b.textContent.includes("New branch account"),
        );
        btn?.click();
      });
    });
    await page.waitForSelector("form select", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    fs.mkdirSync("./out", { recursive: true });
    await page.screenshot({ path: "./out/role-modal-branch.png" });

    // Switch role to order_manager, screenshot again (outlet field should disappear)
    await page.select("form select", "order_manager");
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/role-modal-order-manager.png" });

    console.log("Saved role-modal-branch.png and role-modal-order-manager.png");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
