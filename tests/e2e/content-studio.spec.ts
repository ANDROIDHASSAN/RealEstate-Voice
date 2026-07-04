import { expect, test, type Page } from '@playwright/test';

/**
 * Content Studio v2 E2E — drives the real UI (demo account, Empire plan → has
 * `content` + `ads` after the seed reconcile) through every tab and the key
 * buttons: generate, compose→publish, media, connections, ads launch, research.
 * All providers run in mock mode (FORCE_MOCK_PROVIDERS on the e2e API server).
 */

async function loginDemo(page: Page) {
  await page.addInitScript(() => localStorage.setItem('cf-onboarded', '1'));
  await page.goto('/login');
  await page.getByRole('button', { name: /Try the live demo/i }).click();
  await page.waitForURL('**/', { timeout: 20_000 });
  await page.goto('/content');
  // Studio header + tab bar rendered (overview query resolved).
  await expect(page.getByRole('heading', { name: 'Content Studio' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Composer/ })).toBeVisible({ timeout: 20_000 });
}

test.describe.serial('Content Studio E2E', () => {
  test.beforeEach(async ({ page }) => {
    // The first /content load compiles a large Vite chunk on-demand — give it room.
    test.setTimeout(120_000);
    await loginDemo(page);
  });

  test('renders the studio shell: KPI row + all six tabs', async ({ page }) => {
    for (const tab of ['Composer', 'Calendar', 'Media', 'Connections', 'Ads Manager', 'Market Research']) {
      await expect(page.getByRole('button', { name: new RegExp(tab) })).toBeVisible();
    }
    // KPI stat cards present
    await expect(page.getByText('Scheduled')).toBeVisible();
    await expect(page.getByText('Published', { exact: true })).toBeVisible();
  });

  test('composer: generate AI variants → apply → publish now → shows on calendar', async ({ page }) => {
    // Composer is the default tab.
    await page.getByPlaceholder('What is the post about?').fill('Just listed 3BR waterfront condo in Brickell');
    await page.getByRole('button', { name: /Generate .*variants/i }).click();

    // A variant card appears; clicking it fills the caption.
    const variant = page.locator('button:has-text("standout opportunity"), button:has-text("hit the market")').first();
    await expect(variant).toBeVisible({ timeout: 20_000 });
    await variant.click();
    const caption = page.getByPlaceholder('Write your caption…');
    await expect(caption).not.toBeEmpty();

    // Publish now to the selected channel(s).
    await page.getByText('Publish now').click();
    await page.getByRole('button', { name: /Publish to \d+ channel/i }).click();
    await expect(page.getByText(/Publishing now|Scheduled!/)).toBeVisible({ timeout: 15_000 });

    // Calendar tab shows the post with a status badge.
    await page.getByRole('button', { name: /Calendar/ }).click();
    await expect(page.getByText(/Published|Publishing/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('media: add an asset by URL → appears in the library', async ({ page }) => {
    await page.getByRole('button', { name: /Media/ }).click();
    await page.getByPlaceholder('Name').first().fill('E2E hero shot');
    await page.getByPlaceholder('https://…').fill('https://placehold.co/1080x1080/D2ECDB/1A1A1A?text=E2E');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByText('E2E hero shot')).toBeVisible({ timeout: 15_000 });
  });

  test('connections: connecting a platform updates its status', async ({ page }) => {
    await page.getByRole('button', { name: /Connections/ }).click();
    const connectBtn = page.getByRole('button', { name: /^Connect$/ }).first();
    await expect(connectBtn).toBeVisible({ timeout: 15_000 });
    await connectBtn.click();
    // In mock mode (no real OAuth) connecting records intent → status becomes
    // "Needs key" (pending) — the honest outcome, surfaced as a badge.
    await expect(page.getByText('Needs key').first()).toBeVisible({ timeout: 15_000 });
  });

  test('ads: build + launch a campaign → board shows it with metrics', async ({ page }) => {
    await page.getByRole('button', { name: /Ads Manager/ }).click();
    await page.getByPlaceholder(/Lakeside Open House/i).fill('E2E Open House — Brickell');
    await page.getByPlaceholder(/Just listed: 3BR/i).fill('Waterfront 3BR — Open Saturday');
    await page.getByPlaceholder(/Describe the listing/i).fill('Tour a stunning Brickell condo this weekend.');
    await page.getByRole('button', { name: /Launch campaign/i }).click();
    // Campaign card renders on the board (name + metric labels appear after sync).
    await expect(page.getByText('E2E Open House — Brickell').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Impressions').first()).toBeVisible({ timeout: 20_000 });
  });

  test('research: searching the Ad Library returns competitor cards', async ({ page }) => {
    await page.getByRole('button', { name: /Market Research/ }).click();
    await page.getByPlaceholder(/Miami luxury condos/i).fill('Miami luxury condos');
    await page.getByRole('button', { name: /Research competitors/i }).click();
    // Sample competitor ads render (advertiser is labeled [SAMPLE] in mock mode).
    await expect(page.getByText(/\[SAMPLE\]/).first()).toBeVisible({ timeout: 20_000 });
  });
});
