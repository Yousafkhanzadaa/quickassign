// End-to-end browser test against the running docker compose stack.
// Run with ./scripts/e2e.sh (it executes inside the web container's network namespace,
// so http://localhost:3000 is the real app origin).
//
//   E2E_SOLVE=1    also solve a small task with OpenAI and download the PDF (costs ~1 credit
//                  and a few cents of API usage; needs OPENAI_API_KEY in .env)
//   E2E_SAFEPAY=1  with PAYMENTS_PROVIDER=safepay and SAFEPAY_ENV=sandbox, pay on Safepay's real
//                  sandbox checkout with Safepay's test card (refuses any non-sandbox checkout)
//
// The test signs up two throwaway accounts on the real sign-up page and deletes both at
// the end through the real "Delete account" flow.
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const SOLVE = process.env.E2E_SOLVE === "1";
const SAFEPAY = process.env.E2E_SAFEPAY === "1";
const run = randomUUID().slice(0, 8);
const userA = { name: "Ayesha Khan", email: `e2e-a-${run}@example.com`, password: `pw-${randomUUID()}` };
const userB = { name: "Other Student", email: `e2e-b-${run}@example.com`, password: `pw-${randomUUID()}` };
const email = userA.email;
mkdirSync("results", { recursive: true });

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✗ ${msg}`); };
const step = (msg) => console.log(`\n${msg}`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); // phone-sized
const page = await ctx.newPage();
const pageErrors = [];
// Only our own pages count: Safepay's checkout has its own policy and console noise.
const ours = () => page.url().startsWith(BASE);
page.on("console", (m) => { if (ours() && /Content Security Policy|Refused to/.test(m.text())) pageErrors.push(m.text()); });
page.on("pageerror", (e) => { if (ours()) pageErrors.push(e.message); });
const shot = (name) => page.screenshot({ path: `results/${name}.png`, fullPage: true });
// Fills in and submits the sign-up form on the current page.
async function signUp(p, user) {
  await p.fill("#name", user.name);
  await p.fill("#email", user.email);
  await p.fill("#password", user.password);
  await p.click("button:has-text('Create account')");
}
// Tries to sign in on a fresh page of context; true when it gets past the sign-in page.
async function signInWorks(context, user) {
  const p = await context.newPage();
  try {
    await p.goto(`${BASE}/sign-in`);
    await p.fill("#email", user.email);
    await p.fill("#password", user.password);
    await p.click("button:has-text('Sign in')");
    await Promise.race([
      p.waitForURL((u) => u.pathname !== "/sign-in", { timeout: 15000 }),
      p.locator("text=Email or password is incorrect").waitFor({ timeout: 15000 }),
    ]).catch(() => {});
    return new URL(p.url()).pathname !== "/sign-in";
  } finally {
    await p.close();
  }
}
// Completes onboarding (name comes from the account) and waits for the next page.
async function onboard(p, next) {
  await p.fill("#roll_number", "21L-1234");
  await p.fill("#university", "FAST NUCES Lahore");
  for (const n of ["adult", "terms", "wa_risk"]) await p.check(`input[name=${n}]`);
  await p.click("button:has-text('Continue')");
  await p.waitForURL(next, { timeout: 15000 });
}
// Deletes an account through Settings and waits until it can no longer sign in.
async function deleteAccount(context, p, user, label) {
  await p.goto(`${BASE}/settings`);
  await p.fill("input[name=confirm]", "DELETE");
  await p.fill("input[name=password]", "not-my-password");
  await p.click("button:has-text('Delete my account')");
  const refused = await p.locator("text=That password is incorrect").waitFor({ timeout: 15000 }).then(() => true, () => false);
  refused ? ok(`${label}: deleting needs the right password`) : bad(`${label}: deleting went ahead with a wrong password`);
  await p.fill("input[name=confirm]", "DELETE");
  await p.fill("input[name=password]", user.password);
  await p.click("button:has-text('Delete my account')");
  await p.waitForURL(`${BASE}/`, { timeout: 15000 });
  const r = await p.goto(`${BASE}/dashboard`);
  new URL(p.url()).pathname === "/sign-in" ? ok(`${label}: signed out everywhere after deleting`) : bad(`${label}: still signed in (${p.url()})`);
  // The worker's purge job deletes the account a moment later.
  let gone = false;
  for (let i = 0; i < 6 && !gone; i++) {
    await p.waitForTimeout(2500);
    gone = !(await signInWorks(context, user));
  }
  gone ? ok(`${label}: account purged; its password no longer works`) : bad(`${label}: sign-in still works after deletion`);
  return r;
}

let paymentId = null;
try {
  step("0. Landing page, legal pages and pricing");
  await page.goto(BASE);
  const h1 = (await page.locator("h1").first().innerText()).trim();
  h1.includes("Never miss an assignment") ? ok("landing page renders") : bad(`unexpected landing heading: ${h1}`);
  const pricing = await page.locator("#pricing").innerText();
  for (const price of ["PKR 500", "PKR 1,000", "10 worked solutions", "25 worked solutions"]) {
    pricing.includes(price) ? ok(`pricing shows ${price}`) : bad(`pricing is missing ${price}`);
  }
  await shot("0-landing");
  for (const [path, heading] of [["/privacy", "Privacy policy"], ["/terms", "Terms of service"], ["/refunds", "Refund policy"]]) {
    const r = await page.goto(`${BASE}${path}`);
    const title = (await page.locator("h1").first().innerText()).trim();
    r.status() === 200 && title === heading ? ok(`${path} renders`) : bad(`${path}: HTTP ${r.status()}, heading ${title}`);
  }
  const hook = await page.request.post(`${BASE}/api/payments/safepay/webhook`, { data: { type: "payment:created", data: { tracker: "track_test123" } } });
  [401, 404].includes(hook.status()) ? ok(`unsigned webhook rejected (${hook.status()})`) : bad(`unsigned webhook got HTTP ${hook.status()}`);
  const app = await page.goto(`${BASE}/dashboard`);
  new URL(page.url()).pathname === "/sign-in" && app.status() === 200 ? ok("signed-out visitors are sent to sign-in") : bad(`dashboard while signed out: ${page.url()}`);

  step("1. Choose a plan, sign up and onboard");
  await page.goto(BASE);
  await page.click("#pricing a:has-text('Choose Basic')");
  await page.waitForURL("**/sign-up?plan=basic", { timeout: 15000 });
  ok("plan button leads to sign-up with the plan");
  await page.fill("#name", userA.name);
  await page.fill("#email", userA.email);
  await page.fill("#password", "short");
  await page.click("button:has-text('Create account')");
  new URL(page.url()).pathname === "/sign-up" ? ok("a too-short password is refused") : bad(`short password accepted: ${page.url()}`);
  await signUp(page, userA);
  await page.waitForURL("**/onboarding?plan=basic", { timeout: 15000 });
  ok("sign-up carries the plan through to onboarding");
  const session = (await ctx.cookies()).find((c) => c.name === "qa_session");
  session?.httpOnly && session.sameSite === "Lax" ? ok("session cookie is HttpOnly and SameSite=Lax") : bad(`session cookie flags: ${JSON.stringify(session && { httpOnly: session.httpOnly, sameSite: session.sameSite })}`);
  (await page.inputValue("#full_name")) === "Ayesha Khan" ? ok("name pre-filled from the account") : bad("name not pre-filled");
  await onboard(page, "**/billing?plan=basic");
  ok("onboarding completed, landed on the chosen plan");
  const credits = async () => Number((await page.locator("[data-testid=credits]").innerText()).match(/\d+/)?.[0] ?? -1);
  const before = await credits();
  before === 5 ? ok("5 free trial credits") : bad(`expected 5 trial credits, got ${before}`);

  step("1b. Pay for the Basic plan");
  if ((await page.locator("text=Test mode").count()) === 0 && SAFEPAY) {
    await page.click("button:has-text('Buy Basic')");
    await page.waitForURL(/getsafepay\.com\/embedded/, { timeout: 30000 });
    const host = new URL(page.url()).hostname;
    if (host !== "sandbox.api.getsafepay.com") throw new Error(`refusing to pay: checkout is on ${host}, not Safepay's sandbox`);
    ok("redirected to Safepay's sandbox checkout");
    (await page.locator("text=Rs.500.00").count()) > 0 ? ok("Safepay shows Rs.500.00 (amount set by our server)") : bad("Safepay amount missing");
    await page.fill("input[type=email]", email);
    await page.keyboard.press("Tab");
    await page.locator("input[type=tel]").first().fill("3001234567");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(4000);
    const field = page.locator("input[type=text]");
    await field.nth(0).pressSequentially("4456530000001005", { delay: 20 }); // Safepay sandbox: frictionless 3-D Secure, approved
    await field.nth(1).pressSequentially("1230", { delay: 20 });
    await field.nth(2).pressSequentially("123", { delay: 20 });
    await field.nth(3).fill("Ayesha");
    await field.nth(4).fill("Khan");
    await field.nth(5).fill("1 Mall Road");
    await field.nth(6).fill("Lahore");
    await page.click("button:has-text('Pay Rs.500.00')");
    await page.waitForURL(/localhost:3000\/billing\/return\/[0-9a-f-]{36}/, { timeout: 90000 });
    paymentId = new URL(page.url()).pathname.split("/").pop();
    ok("Safepay sent the student back to QuickAssign");
    for (let i = 0; i < 10 && (await page.locator("text=Payment received").count()) === 0; i++) {
      await page.waitForTimeout(2000);
      await page.reload();
    }
    (await page.locator("text=Payment received").count()) > 0 ? ok("payment verified with Safepay's API") : bad("payment not confirmed");
    let after = await credits();
    for (let i = 0; i < 20 && after !== 15; i++) {
      await page.waitForTimeout(250);
      after = await credits();
    }
    after === 15 ? ok("header credits 5 -> 15 after a real sandbox payment") : bad(`expected 15 credits, got ${after}`);
    await shot("1-safepay-payment-received");
    await page.goto(`${BASE}/billing/return?payment=${paymentId}?tracker=track_appended_by_safepay`);
    page.url().endsWith(`/billing/return/${paymentId}`) ? ok("old-style return link with Safepay's appended tracker still works") : bad(`legacy link went to ${page.url()}`);
    await page.reload();
    const again = await credits();
    again === 15 ? ok("re-checking the payment doesn't add credits twice") : bad(`credits changed on re-check: ${again}`);
  } else if ((await page.locator("text=Test mode").count()) === 0) {
    console.log("  · skipped: use PAYMENTS_PROVIDER=mock, or E2E_SAFEPAY=1 with Safepay sandbox keys");
  } else {
    await page.click("button:has-text('Buy Basic')");
    await page.waitForURL(/\/billing\/mock\?payment=[0-9a-f-]{36}$/, { timeout: 15000 });
    paymentId = new URL(page.url()).searchParams.get("payment");
    (await page.locator("text=PKR 500").count()) > 0 ? ok("checkout shows PKR 500 from the server") : bad("checkout amount missing");
    await page.click("button:has-text('Pay with JazzCash (simulated)')");
    await page.waitForURL(/\/billing\/return\/[0-9a-f-]{36}/, { timeout: 15000 });
    (await page.locator("text=Payment received").count()) > 0 ? ok("payment confirmed") : bad("payment not confirmed");
    let after = await credits();
    for (let i = 0; i < 20 && after !== 15; i++) {
      await page.waitForTimeout(250);
      after = await credits();
    }
    after === 15 ? ok("header credits 5 -> 15 after paying") : bad(`expected 15 credits, got ${after}`);
    await shot("1-payment-received");
    // Paying again for the same checkout must not add credits twice.
    await page.goto(`${BASE}/billing/mock?payment=${paymentId}`);
    await page.click("button:has-text('Pay with Easypaisa (simulated)')");
    await page.waitForURL(/\/billing\/return\/[0-9a-f-]{36}/, { timeout: 15000 });
    const again = await credits();
    again === 15 ? ok("repeating a payment is idempotent (still 15)") : bad(`credits changed on repeat: ${again}`);
    await page.goto(`${BASE}/billing`);
    (await page.locator("text=Ref ").count()) > 0 ? ok("payment history shows a reference") : bad("no payment reference shown");
  }
  await page.goto(`${BASE}/whatsapp`);

  step("2. WhatsApp pairing QR (real connection to WhatsApp)");
  await page.click("button:has-text('Scan QR code')");
  await page.click("button:has-text('Show QR code')");
  try {
    await page.waitForSelector("img[alt='WhatsApp linking QR code']", { timeout: 30000 });
    ok("QR code received from WhatsApp via the gateway");
  } catch {
    bad("no QR code (is the gateway running and online?)");
  }
  await shot("1-whatsapp-qr");

  step("3. Course and material upload");
  await page.goto(`${BASE}/courses`);
  await page.fill("input[name=name]", "Calculus I");
  await page.fill("input[name=code]", "MT101");
  await page.click("button:has-text('Add course')");
  await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const courseUrl = page.url();
  // Build a small lecture PDF on the fly with Chromium's PDF printer.
  const pdfPage = await ctx.newPage();
  await pdfPage.setContent("<h1>Lecture 3: Derivatives</h1><p>The power rule: d/dx x^n = n x^(n-1). The product rule: (fg)' = f'g + fg'.</p>");
  writeFileSync("results/lecture-3.pdf", await pdfPage.pdf());
  await pdfPage.close();
  await page.setInputFiles("input[type=file]", "results/lecture-3.pdf");
  await page.waitForSelector("a:has-text('lecture-3.pdf')", { timeout: 15000 });
  ok("material uploaded");
  await page.waitForTimeout(8000);
  await page.reload();
  const matStatus = (await page.locator("li:has(a:has-text('lecture-3.pdf')) span.text-xs").first().innerText()).trim();
  console.log(`  · material status: ${matStatus} (Ready needs OPENAI_API_KEY for embeddings)`);
  await shot("2-course");

  step("4. Manual task");
  await page.goto(`${BASE}/tasks/new`);
  await page.fill("#title", "Calculus Assignment 1: Derivatives");
  await page.selectOption("#course_id", { label: "MT101 · Calculus I" });
  await page.fill("#deadline", "2030-01-15T23:59");
  await page.fill("#description", "Q1. Differentiate f(x) = 3x^4 - 2x + 7.\nQ2. Differentiate g(x) = x^2 sin(x) using the product rule.");
  await page.click("button:has-text('Save task')");
  await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 15000 });
  const taskUrl = page.url();
  ok(`task created: ${(await page.locator("h1").innerText()).trim()}`);

  if (SOLVE) {
    step("5. Solve with OpenAI (E2E_SOLVE=1)");
    await page.click("button:has-text('Get worked solution')");
    let delivered = false;
    for (let i = 0; i < 60 && !delivered; i++) {
      await page.waitForTimeout(10000);
      await page.reload();
      const status = (await page.locator("main .badge").first().innerText()).trim();
      process.stdout.write(`  · ${status}\n`);
      if (status === "Failed") break;
      delivered = (await page.locator("a:has-text('PDF')").count()) > 0;
    }
    if (delivered) {
      const href = await page.locator("a:has-text('PDF')").first().getAttribute("href");
      const res = await page.request.get(`${BASE}${href}`);
      writeFileSync("results/solution.pdf", await res.body());
      ok(`solution PDF downloaded (${(await res.body()).length} bytes) -> tests/e2e/results/solution.pdf`);
    } else {
      bad("no solution PDF (check: docker compose logs worker)");
    }
    await shot("3-task-solved");
  } else {
    console.log("\n5. Solve skipped (run with E2E_SOLVE=1 to test OpenAI solving)");
    await shot("3-task");
  }

  step("6. Settings");
  await page.goto(`${BASE}/settings`);
  (await page.locator(`text=${email}`).count()) > 0 ? ok("settings shows the account's email") : bad("account email missing in settings");
  (await page.locator("button:has-text('Sign out of all devices')").count()) > 0 ? ok("sign out of all devices is available") : bad("no sign-out-everywhere button");

  step("7. Isolation between students");
  const ctx2 = await browser.newContext();
  (await signInWorks(ctx2, { email: userA.email, password: "not-the-password" }))
    ? bad("signed in with a wrong password")
    : ok("a wrong password is refused");
  const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/sign-up`);
  await signUp(p2, userB);
  await p2.waitForURL("**/onboarding", { timeout: 15000 });
  await onboard(p2, "**/whatsapp");
  for (const url of [taskUrl, courseUrl]) {
    const r = await p2.goto(url);
    if (r.status() === 404) ok(`other student blocked from ${new URL(url).pathname.split("/")[1]} (404)`);
    else bad(`other student got HTTP ${r.status()} for ${url}`);
  }
  const r = await p2.request.get(`${BASE}/api/files/00000000-0000-0000-0000-000000000000`);
  r.status() === 404 ? ok("unknown file id -> 404") : bad(`file endpoint returned ${r.status()}`);
  if (paymentId) {
    for (const path of [`/billing/return/${paymentId}`, `/billing/mock?payment=${paymentId}`]) {
      const res = await p2.goto(`${BASE}${path}`);
      res.status() === 404 ? ok(`other student can't see the payment (${path.split("?")[0]} -> 404)`) : bad(`${path} returned ${res.status()} for another student`);
    }
  }

  step("8. Deleting accounts (also cleans up the test users)");
  await deleteAccount(ctx2, p2, userB, "student B");
  await deleteAccount(ctx, page, userA, "student A");
} catch (err) {
  bad(`unexpected error: ${err.message}`);
  await shot("error").catch(() => {});
}

step("9. Browser security");
pageErrors.length === 0 ? ok("no CSP violations or page errors") : bad(`page errors: ${pageErrors.join(" | ")}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
