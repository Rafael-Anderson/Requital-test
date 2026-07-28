// Reproduces & traces the "editing a variant doesn't save" report:
// navigates to a real product edit page, opens the variant edit modal,
// changes the price, clicks Save, and logs every network request,
// navigation event, and console message so the actual cause is visible
// instead of guessed at.
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const CHROME_PATH =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PRODUCT_ID = process.env.PRODUCT_ID;
if (!PRODUCT_ID) throw new Error("Set PRODUCT_ID env var");

async function main() {
  const auth = JSON.parse(fs.readFileSync("./auth.json", "utf8"));

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    const requests = [];
    page.on("request", (req) => {
      requests.push({ method: req.method(), url: req.url() });
    });
    const navigations = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    const consoleMsgs = [];
    page.on("console", (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => consoleMsgs.push(`[pageerror] ${err.message}`));

    await page.evaluateOnNewDocument(
      (accessToken, refreshToken) => {
        localStorage.setItem("requital_admin_access_token", accessToken);
        localStorage.setItem("requital_admin_refresh_token", refreshToken);
      },
      auth.accessToken,
      auth.refreshToken,
    );

    const editUrl = `http://localhost:3001/inventory/${PRODUCT_ID}/edit`;
    await page.goto(editUrl, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 800));

    console.log("=== Before opening modal ===");
    console.log("page.url():", page.url());

    // Open the variant edit modal via the pencil icon in the first variant row.
    const editButtonSelector = 'table button[aria-label^="Edit "]';
    await page.waitForSelector(editButtonSelector, { timeout: 10000 });
    await page.click(editButtonSelector);
    await page.waitForSelector("form input", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 300));

    // Mark the point in the requests/navigations arrays where we start caring.
    const requestsBeforeClick = requests.length;
    const navigationsBeforeClick = navigations.length;

    // Find the Price input inside the modal (first number input) and change it.
    const priceInputSelector = 'form.max-w-md input[type="number"]';
    await page.waitForSelector(priceInputSelector, { timeout: 5000 });
    await page.click(priceInputSelector, { clickCount: 3 });
    await page.type(priceInputSelector, "77.50");

    console.log("=== Clicking Save changes ===");
    // Scoped specifically to the modal's own form (max-w-md is unique to
    // it) — ProductForm's page also has its own "Save changes" button with
    // identical text, and after the portal fix the modal's DOM position
    // moves to the end of <body>, so a page-wide text match would silently
    // grab the wrong one.
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('form.max-w-md button[type="submit"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Save button found and clicked:", clicked);

    await new Promise((r) => setTimeout(r, 1500));

    console.log("=== After clicking Save ===");
    console.log("page.url():", page.url());
    console.log(
      "New requests fired:",
      JSON.stringify(requests.slice(requestsBeforeClick), null, 2),
    );
    console.log(
      "New navigations:",
      JSON.stringify(navigations.slice(navigationsBeforeClick), null, 2),
    );
    console.log("Console/page messages:\n" + consoleMsgs.join("\n"));

    // Is the modal still open / did the page tree survive (i.e. no reload)?
    const modalStillPresent = await page.evaluate(
      () => !!document.querySelector('input[type="number"]'),
    );
    console.log("A number input is still present in DOM:", modalStillPresent);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
