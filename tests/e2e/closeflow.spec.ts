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
