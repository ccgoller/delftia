const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function mockFeeds(page, { empty = false, failPublications = false } = {}) {
  await page.route('https://www.ebi.ac.uk/europepmc/webservices/rest/search?**', route => {
    if (failPublications) return route.fulfill({ status: 503, body: 'Unavailable' });
    expect(new URL(route.request().url()).searchParams.get('query')).toBe('Delftia sort_date:y');
    return route.fulfill({ json: { resultList: { result: empty ? [] : [{
      id: '123', source: 'MED', title: 'Delftia research <script>alert(1)</script>',
      authorString: 'Research team', firstPublicationDate: '2026-10-01', doi: '10.1234/delftia',
    }] } } });
  });
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('query')).toBe('tax_tree(80865)');
    expect(params.get('limit')).toBe('0');
    return route.fulfill({ json: empty ? [] : [
      { assembly_accession: 'GCA_000001', scientific_name: 'Delftia acidovorans', last_updated: '2025-01-01' },
      { assembly_accession: 'GCA_000002', scientific_name: 'Delftia tsuruhatensis', last_updated: '2026-10-02' },
    ] });
  });
}

for (const path of ['research', 'people', 'dashboard', 'learn']) {
  for (const theme of ['light', 'dark']) {
    test(`${path} page is accessible in ${theme} mode`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
      await mockFeeds(page);
      await page.goto(`/${path}.html`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(path, 'i'));
      if (path === 'dashboard') {
        await expect(page.locator('#genomes-list li')).toHaveCount(2);
        await expect(page.locator('#publications-list li')).toHaveCount(1);
      }
      for (const name of ['Research', 'People', 'Dashboard', 'Learn']) {
        await expect(page.getByRole('link', { name, exact: true }).last()).toBeVisible();
      }
      if (path === 'learn') {
        await expect(page.getByRole('link', { name: 'Visit MB 360' })).toHaveAttribute('href', 'https://go.ncsu.edu/mb360');
        await expect(page.getByRole('link', { name: 'Read the Delftia book' })).toHaveAttribute('href', 'https://go.ncsu.edu/delftiabook');
      }
      await expect(page.getByRole('button', { name: 'Reading focus', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Reading focus', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      expect(results.violations).toEqual([]);
    });
  }
}

test('dashboard displays safe linked records sorted by date and refreshes', async ({ page }) => {
  await mockFeeds(page);
  await page.goto('/dashboard.html');
  await expect(page.locator('#publications-list li')).toHaveCount(1);
  await expect(page.locator('#genomes-list li').first()).toContainText('GCA_000002');
  await expect(page.locator('#publications-list a')).toHaveText('Delftia research <script>alert(1)</script>');
  await expect(page.locator('#publications-list script')).toHaveCount(0);
  await expect(page.locator('#publications-list a')).toHaveAttribute('href', 'https://doi.org/10.1234%2Fdelftia');
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('#publications-list li')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Refresh dashboard' })).toBeEnabled();
});

test('dashboard handles independent failures and retries', async ({ page }) => {
  await mockFeeds(page, { failPublications: true });
  await page.goto('/dashboard.html');
  await expect(page.locator('#publications-status')).toContainText('Unable to load');
  await expect(page.locator('#genomes-list li')).toHaveCount(2);
  await page.unrouteAll({ behavior: 'wait' });
  await mockFeeds(page);
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('#publications-list li')).toHaveCount(1);
});

test('dashboard explains empty results', async ({ page }) => {
  await mockFeeds(page, { empty: true });
  await page.goto('/dashboard.html');
  await expect(page.locator('#publications-status')).toContainText('No publications records found');
  await expect(page.locator('#genomes-status')).toContainText('No genomes records found');
});

test('dashboard keeps database links available without JavaScript', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: testInfo.project.use.viewport });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8000/dashboard.html');
  await expect(page.locator('#publications-status')).toContainText('require JavaScript');
  await expect(page.getByRole('link', { name: 'Browse all Delftia publications on Europe PMC' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse Delftia genome assemblies on ENA' })).toBeVisible();
  await context.close();
});
