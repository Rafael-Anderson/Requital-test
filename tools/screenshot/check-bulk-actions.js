const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

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
    const downloadPath = path.resolve("./out/downloads");
    fs.mkdirSync(downloadPath, { recursive: true });
    const client = await page.createCDPSession();
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });

    await page.evaluateOnNewDocument(
      (accessToken, refreshToken) => {
        localStorage.setItem("requital_admin_access_token", accessToken);
        localStorage.setItem("requital_admin_refresh_token", refreshToken);
      },
      auth.accessToken,
      auth.refreshToken,
    );

    fs.mkdirSync("./out", { recursive: true });

    await page.goto("http://localhost:3001/inventory", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    // Select the first two rows.
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('tbody input[type="checkbox"]'));
      boxes[0].click();
      boxes[1].click();
    });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/bulk-1-selected.png" });

    // Apply bulk status change to "Draft".
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const bulkSelect = selects.find((s) => Array.from(s.options).some((o) => o.text === "Set status…"));
      const opt = Array.from(bulkSelect.options).find((o) => o.text === "Draft");
      bulkSelect.value = opt.value;
      bulkSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const applyClicked = await page.evaluate(() => {
      const bar = Array.from(document.querySelectorAll("div")).find((d) => d.textContent.includes("2 selected"));
      const btn = Array.from(bar.querySelectorAll("button")).find((b) => b.textContent.trim() === "Apply");
      btn?.click();
      return !!btn;
    });
    console.log("Bulk status Apply clicked:", applyClicked);
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: "./out/bulk-2-after-status.png" });

    const statusesNow = await page.evaluate(() =>
      Array.from(document.querySelectorAll("tbody tr")).map((tr) => {
        const name = tr.querySelector("td:nth-child(2)")?.textContent.trim();
        const status = tr.textContent.includes("Disabled") ? "Disabled" : "Active";
        return { name, status };
      }),
    );
    console.log("Row statuses after bulk update:", JSON.stringify(statusesNow));

    // Select again for export.
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('tbody input[type="checkbox"]'));
      boxes[0].click();
      boxes[1].click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const exportClicked = await page.evaluate(() => {
      const bar = Array.from(document.querySelectorAll("div")).find((d) => d.textContent.includes("2 selected"));
      const btn = Array.from(bar.querySelectorAll("button")).find((b) => b.textContent.trim() === "Export CSV");
      btn?.click();
      return !!btn;
    });
    console.log("Export CSV clicked:", exportClicked);
    await new Promise((r) => setTimeout(r, 1500));

    const downloaded = fs.readdirSync(downloadPath);
    console.log("Downloaded files:", downloaded);
    if (downloaded.length > 0) {
      const content = fs.readFileSync(path.join(downloadPath, downloaded[0]), "utf8");
      console.log("CSV content (first 300 chars):", content.slice(0, 300));
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
