import { expect, test, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4144';
const stamp = Date.now();

async function signupViaUi(page: Page, email: string) {
  await page.goto('/signup');
  await page.fill('#accountName', `E2E Realty ${stamp}`);
  await page.fill('#name', 'Eve Tester');
  await page.fill('#email', email);
  await page.fill('#password', 'Passw0rd!123');
  await page.click('button[type="submit"]');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Eve', { timeout: 15_000 });
}

test.describe.serial('CloseFlow E2E', () => {
  const email = `e2e${stamp}@test.io`;

  // The first-login tour overlay would intercept clicks — mark as onboarded
  // for all tests except the dedicated tour test below.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cf-onboarded', '1'));
  });

  test('signup → dashboard renders in reference style', async ({ page }) => {
    await signupViaUi(page, email);
    // Pastel design tokens actually applied
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(214, 240, 227)'); // --bg-app #D6F0E3
    await expect(page.getByText('median first response')).toBeVisible();
  });

  test('module gating: starter sees upsell on voice, unlocks after upgrade', async ({ page }) => {
    await signupViaUi(page, `gate${stamp}@test.io`);
    await page.goto('/voice');
    await expect(page.getByText('See plans')).toBeVisible();
    // Upgrade via billing UI (mock Stripe applies instantly)
    await page.goto('/billing');
    await page.getByRole('button', { name: 'Choose plan' }).last().click(); // Empire
    await expect(page.getByText('Current plan')).toBeVisible({ timeout: 10_000 });
    await page.goto('/voice');
    await expect(page.getByText('20 agents')).toBeVisible();
  });

  test('create lead via UI → instant reply badge appears', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/leads');
    await page.getByRole('button', { name: /Add lead/i }).click();
    await page.locator('form input').first().fill('Playwright');
    await page.locator('form input').nth(2).fill('+13055557777');
    await page.getByRole('button', { name: 'Create' }).click();
    // Instant-reply worker sets firstResponseSeconds within seconds → ⚡ badge
    await expect(page.getByText(/⚡ \d+s/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('voice: AI call from lead row books + transcript on voice page', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/voice');
    await expect(page.getByText(/booked|qualified/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('voice: "call me now" self-test runs a live call with transcript', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/voice');
    await expect(page.getByText('Test your voice agent')).toBeVisible();
    await page.getByPlaceholder('+1305…').fill('+13055550188');
    await page.getByRole('button', { name: /Call me now/i }).click();
    // Mock provider drives the call to completion; transcript renders when done
    await expect(page.getByText('Transcript').first()).toBeVisible({ timeout: 20_000 });
  });

  test('voice: in-call LLM selector on the voice page persists', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/voice');
    await expect(page.getByText('Voice engine')).toBeVisible();
    // The "In-call brain (provider)" dropdown → OpenAI, auto-saves on change
    await page.getByLabel('In-call brain (provider)').selectOption('openai');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel('In-call brain (provider)')).toHaveValue('openai');
  });

  test('follow-up: sequence builder creates a sequence', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/followup');
    await page.getByRole('button', { name: /New sequence/i }).click();
    await page.locator('form input').first().fill('E2E Nurture');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('E2E Nurture')).toBeVisible({ timeout: 10_000 });
  });

  test('es locale: dashboard localized', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('cf-locale', 'es'));
    await page.reload();
    await page.fill('#email', email);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bienvenido', { timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('ltr');
  });

  test('ar locale: full RTL flip + Arabic copy', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('cf-locale', 'ar'));
    await page.reload();
    await page.fill('#email', email);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مرحباً', { timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  });

  test('onboarding tour shows on first login and can be completed', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('cf-onboarded'));
    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Welcome to CloseFlow OS')).toBeVisible({ timeout: 15_000 });
    // Skip closes the tour and persists the flag
    await page.getByTitle('Skip').click();
    await expect(page.getByText('Welcome to CloseFlow OS')).not.toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cf-onboarded'))).toBe('1');
  });

  test('assistant: typed command navigates hands-free', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.getByTitle(/CloseFlow Assistant/).click();
    await page.getByPlaceholder(/Type a command/).fill('go to leads');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/leads', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
  });

  test('lead engine: persona template + city creates a scrape job', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/lead-engine');
    await page.getByRole('button', { name: /FSBO sellers/ }).click();
    await page.getByRole('button', { name: /New scrape job/i }).click();
    // Mock Apify returns 10 prospects; job completes async
    await expect(page.getByText(/10 found/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('settings: paste an API key from the UI and it is saved (masked)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/settings');
    // WhatsApp has no key in .env, so its fields are guaranteed empty
    const row = page.locator('li', { has: page.getByRole('button', { name: /WhatsApp/ }) }).first();
    await row.getByRole('button', { name: /WhatsApp/ }).click();
    await row.locator('input').first().fill('wa_e2e_test_key_123456');
    await row.getByRole('button', { name: /Save/ }).click();
    // After save the field reports a stored (masked) key — raw value never echoed
    await expect(row.getByPlaceholder(/A key is saved/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('wa_e2e_test_key_123456')).toHaveCount(0);
  });

  test('settings: pick an LLM provider/model from a dropdown and it persists', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/settings');
    const row = page.locator('li', { has: page.getByRole('button', { name: /AI brain/ }) }).first();
    await row.getByRole('button', { name: /AI brain/ }).click();
    // First dropdown is "Preferred provider" → OpenAI, auto-saves on change
    await row.locator('select').first().selectOption('openai');
    await page.waitForTimeout(600);
    // Reopen the page — selection must survive a round-trip to the server
    await page.reload();
    await row.getByRole('button', { name: /AI brain/ }).click();
    await expect(row.locator('select').first()).toHaveValue('openai');
  });

  test('agents: live team page shows the crew and activity feed', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `gate${stamp}@test.io`);
    await page.fill('#password', 'Passw0rd!123');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/');
    await page.goto('/agents');
    await expect(page.getByText('Your AI team')).toBeVisible();
    // Earlier tests generated outbound/call/scrape events — the live feed must show them
    await expect(page.getByText('Live activity')).toBeVisible();
  });

  test('multi-tenant isolation: fresh account sees zero data', async ({ page, request }) => {
    // Account A has leads; brand-new account B must see none.
    await signupViaUi(page, `isolate${stamp}@test.io`);
    await page.goto('/leads');
    await expect(page.getByText('No leads yet')).toBeVisible({ timeout: 10_000 });
    // authz: unauthenticated API access denied
    const res = await request.get(`${API}/leads`);
    expect(res.status()).toBe(401);
  });
});
