const puppeteer = require("puppeteer-core");
const fs = require("fs");

const ORDER_ID = process.env.ORDER_ID;
if (!ORDER_ID) throw new Error("Set ORDER_ID env var");

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
    fs.mkdirSync("./out", { recursive: true });

    await page.goto(`http://localhost:3001/orders/${ORDER_ID}`, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: "./out/order-notes-1-empty.png" });

    await page.evaluate(() => {
      const textarea = document.querySelector("textarea");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, "Called customer — confirmed delivery for tomorrow morning.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const addClicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Add");
      btn?.click();
      return !!btn;
    });
    console.log("Add clicked:", addClicked);
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: "./out/order-notes-2-after-add.png" });

    const noteVisible = await page.evaluate(() =>
      document.body.textContent.includes("Called customer — confirmed delivery for tomorrow morning."),
    );
    console.log("Note visible after add:", noteVisible);
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
