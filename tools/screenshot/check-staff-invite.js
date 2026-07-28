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
      shopName: `Invite UI Shop ${tag}`,
      subdomain: `invite-ui-${tag}`,
      email: `invite-ui-${tag}@test.com`,
      password: "Passw0rd!",
      name: "Invite UI Bot",
    }),
  });
  const staffEmail = `invited-staffer-${tag}@test.com`;

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
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

    await page.goto("http://localhost:3001/settings/users", { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("New branch account"));
      btn.click();
    });
    await page.waitForSelector("form", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));

    await page.evaluate((email) => {
      const form = document.querySelector("form");
      const nameInput = form.querySelector('input[type="text"], input:not([type])');
      const emailInput = form.querySelector('input[type="email"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(nameInput, "Invited Staffer");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(emailInput, email);
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    }, staffEmail);

    // Leave "Set a password directly" unchecked — default invite-by-email path.
    await page.screenshot({ path: "./out/staff-invite-form.png" });

    await page.evaluate(() => {
      const form = document.querySelector("form");
      const btn = Array.from(form.querySelectorAll("button")).find((b) => b.type === "submit");
      btn.click();
    });

    await page.waitForFunction(() => document.body.textContent.includes("Invite sent"), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "./out/staff-invite-sent.png" });

    const inviteLink = await page.evaluate(() => {
      const a = Array.from(document.querySelectorAll("a")).find((el) => el.href.includes("/accept-invite"));
      return a ? a.href : null;
    });
    console.log("Invite link surfaced in UI:", inviteLink);
    if (!inviteLink) throw new Error("devInviteLink not shown in the invite-sent screen");

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Done");
      btn.click();
    });

    // Confirm the new (unactivated) user shows up in the list.
    await new Promise((r) => setTimeout(r, 400));
    const listedEmail = await page.evaluate((email) => document.body.textContent.includes(email), staffEmail);
    console.log("New staff row visible in users list:", listedEmail);

    // Now act as the invited staffer: open the invite link in a fresh,
    // unauthenticated context (no admin tokens injected).
    const staffPage = await browser.newPage();
    await staffPage.goto(inviteLink, { waitUntil: "networkidle0", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 400));
    await staffPage.screenshot({ path: "./out/accept-invite-form.png" });

    await staffPage.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="password"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inputs[0], "myStaffPassword123");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputs[1], "myStaffPassword123");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });

    await staffPage.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Activate account");
      btn.click();
    });

    await staffPage.waitForFunction(() => location.pathname === "/", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
    await staffPage.screenshot({ path: "./out/accept-invite-landed-dashboard.png" });
    console.log("Landed on:", staffPage.url());

    const storedToken = await staffPage.evaluate(() => !!localStorage.getItem("requital_admin_access_token"));
    console.log("Auto-login stored a real access token:", storedToken);
    if (!storedToken) throw new Error("FAIL: accept-invite did not auto-login the staff member");

    // Direct API confirmation: staffer can now log in independently with
    // the password they chose, and the pre-invite guess still fails.
    await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: staffEmail, password: "myStaffPassword123" }),
    });
    console.log("PASS: staffer can log in with their own chosen password");

    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email: staffEmail, password: "wrongguess123" }) });
      console.log("FAIL: wrong password should have been rejected");
      process.exit(1);
    } catch (e) {
      console.log("PASS: wrong password correctly rejected:", e.message.includes("401"));
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
