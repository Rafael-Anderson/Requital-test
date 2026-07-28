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
    const deleteRequests = [];
    page.on("requestfinished", (req) => {
      if (req.method() === "DELETE") deleteRequests.push({ url: req.url(), status: req.response()?.status() });
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

    await page.evaluate(() => {
      document.querySelector('button[aria-label^="Delete Undo Test Product"]')?.click();
    });
    console.log("Clicked delete, NOT clicking undo — waiting 7s for the window to close...");
    await new Promise((r) => setTimeout(r, 7000));

    console.log("DELETE requests fired after waiting past the undo window:", JSON.stringify(deleteRequests));
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
