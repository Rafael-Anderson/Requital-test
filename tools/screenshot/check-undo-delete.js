const puppeteer = require("puppeteer-core");
const fs = require("fs");

const PRODUCT_ID = process.env.PRODUCT_ID;
if (!PRODUCT_ID) throw new Error("Set PRODUCT_ID env var");

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

    const requests = [];
    page.on("request", (req) => {
      if (req.method() === "DELETE") requests.push(req.url());
    });

    await page.evaluateOnNewDocument(
      (accessToken, refreshToken) => {
        localStorage.setItem("requital_admin_access_token", accessToken);
        localStorage.setItem("requital_admin_refresh_token", refreshToken);
      },
      auth.accessToken,
      auth.refreshToken,
    );
    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));

    const rowSelector = `tr[data-row-id="${PRODUCT_ID}"]`;
    // Rows don't have a data-row-id today — fall back to text match via aria-label.
    const deleteSelBefore = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label^="Delete Undo Test Product"]');
      return !!btn;
    });
    console.log("Delete button present before click:", deleteSelBefore);

    await page.evaluate(() => {
      document.querySelector('button[aria-label^="Delete Undo Test Product"]')?.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    // Scoped to the <table> specifically — the toast itself also contains
    // the product name ("\"Undo Test Product\" deleted"), so a whole-body
    // text search would false-negative here.
    const rowGoneImmediately = await page.evaluate(
      () => !document.querySelector("table")?.textContent.includes("Undo Test Product"),
    );
    console.log("Row removed from table immediately after click:", rowGoneImmediately);

    const toastVisible = await page.evaluate(() => document.body.textContent.includes('"Undo Test Product" deleted'));
    console.log("Undo toast visible:", toastVisible);
    fs.mkdirSync("./out", { recursive: true });
    await page.screenshot({ path: "./out/undo-toast.png" });

    // Click Undo.
    const undoClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Undo");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Undo button found and clicked:", undoClicked);
    await new Promise((r) => setTimeout(r, 800));

    const rowRestored = await page.evaluate(
      () => !!document.querySelector("table")?.textContent.includes("Undo Test Product"),
    );
    console.log("Row restored in table after Undo:", rowRestored);
    await page.screenshot({ path: "./out/undo-restored.png" });

    console.log("DELETE requests fired during the whole Undo flow (should be zero):", requests.length, requests);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
