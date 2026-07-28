const puppeteer = require("puppeteer-core");
const fs = require("fs");

const API = "http://localhost:3000";

async function api(path, opts = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} -> ${res.status}: ${text}`);
  return body;
}

async function main() {
  const tag = Date.now();
  const signup = await api("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      shopName: `WA Settings Shop ${tag}`,
      subdomain: `wa-settings-${tag}`,
      email: `wa-settings-${tag}@test.com`,
      password: "Passw0rd!",
      name: "WA Settings Bot",
    }),
  });

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 1000 },
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(
      (a, r) => {
        localStorage.setItem("requital_admin_access_token", a);
        localStorage.setItem("requital_admin_refresh_token", r);
      },
      signup.accessToken,
      signup.refreshToken,
    );
    fs.mkdirSync("./out", { recursive: true });

    await page.goto("http://localhost:3001/settings/business/information", {
      waitUntil: "networkidle0",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 600));

    const beforeText = await page.evaluate(() => document.body.textContent);
    console.log("Card heading present:", beforeText.includes("WhatsApp Business API"));
    console.log("No-credentials hint present:", beforeText.includes("fall back to a console log"));

    await page.screenshot({ path: "./out/whatsapp-settings-empty.png" });

    // Fill in the two credential fields (both password-type inputs inside the
    // WhatsApp card, identified by their labels).
    const filled = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent.trim() === "WhatsApp Business API");
      if (!heading) return false;
      const card = heading.closest("div").parentElement;
      const inputs = card.querySelectorAll('input[type="password"]');
      if (inputs.length < 2) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], "123456789012345");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputs[1], "EAAG_fake_access_token_value");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    console.log("Credential fields filled:", filled);
    if (!filled) throw new Error("FAIL: could not find WhatsApp credential inputs");

    const saveClicked = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent.trim() === "WhatsApp Business API");
      const card = heading.closest("div").parentElement;
      const btn = Array.from(card.querySelectorAll("button")).find((b) => b.textContent.trim() === "Save");
      if (!btn) return false;
      btn.click();
      return true;
    });
    console.log("Save clicked:", saveClicked);

    await page.waitForFunction(() => document.body.textContent.includes("WhatsApp Cloud API credentials saved"), {
      timeout: 10000,
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: "./out/whatsapp-settings-saved.png" });

    const afterText = await page.evaluate(() => document.body.textContent);
    console.log("Masked value shown after save:", /Currently saved: ••••/.test(afterText));
    console.log("Remove button now present:", afterText.includes("Remove"));

    // Direct API confirmation — masked, never the raw secret, and hasCredentials true.
    const settings = await api("/whatsapp-settings", {}, signup.accessToken);
    console.log("API settings after save:", JSON.stringify(settings));
    if (!settings.hasCredentials) throw new Error("FAIL: hasCredentials should be true after saving");
    if (settings.maskedCredentials.accessToken.includes("EAAG_fake_access_token_value")) {
      throw new Error("FAIL: raw secret leaked in maskedCredentials");
    }
    if (!settings.maskedCredentials.accessToken.startsWith("••••")) {
      throw new Error("FAIL: accessToken not masked");
    }

    console.log("PASS: WhatsApp credentials saved, masked correctly, and confirmed via direct API read");
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
