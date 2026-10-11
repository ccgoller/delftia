const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function mockFeeds(page, { empty = false, failPublications = false, failGenomes = false, failChart = false } = {}) {
  await page.route('https://www.ebi.ac.uk/europepmc/webservices/rest/search?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('query') === 'Delftia AND SRC:MED') {
      if (failChart) return route.fulfill({ status: 503, body: 'Unavailable' });
      expect(params.get('pageSize')).toBe('1000');
      const firstPage = params.get('cursorMark') === '*';
      return route.fulfill({ json: {
        hitCount: empty ? 0 : 3,
        nextCursorMark: firstPage ? 'next-page' : 'last-page',
        resultList: { result: empty ? [] : firstPage
          ? [{ pubYear: '2024' }, { pubYear: '2026' }] : [{ pubYear: '2026' }] },
      } });
    }
    if (failPublications) return route.fulfill({ status: 503, body: 'Unavailable' });
    expect(params.get('query')).toBe('Delftia sort_date:y');
    return route.fulfill({ json: { resultList: { result: empty ? [] : [{
      id: '123', source: 'MED', title: 'Delftia research <script>alert(1)</script>',
      authorString: 'Research team', firstPublicationDate: '2026-10-01', doi: '10.1234/delftia',
    }] } } });
  });
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => {
    if (failGenomes) return route.fulfill({ status: 503, body: 'Unavailable' });
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
        await expect(page.locator('#publications-count')).toHaveText('1');
        await expect(page.locator('#genomes-count')).toHaveText('2');
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
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).fill('tsuruhatensis');
  await expect(page.locator('#genomes-list li:visible')).toHaveCount(1);
  await expect(page.locator('#publications-list li:visible')).toHaveCount(0);
  await expect(page.locator('#dashboard-results-status')).toContainText('Showing 1 of 3');
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).fill('no matching record');
  await expect(page.locator('#dashboard-results-status')).toContainText('No loaded records match');
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).clear();
  await expect(page.locator('#genomes-list li:visible')).toHaveCount(2);
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
  await expect(page.locator('#publications-chart-status')).toHaveText('No PubMed articles found.');
  await expect(page.locator('#genomes-chart-status')).toHaveText('No genome assembly records found.');
  await expect(page.locator('.dashboard-chart li')).toHaveCount(0);
});

test('dashboard charts count all pages, include zero years, and support keyboard and sorting', async ({ page }) => {
  await mockFeeds(page);
  await page.goto('/dashboard.html');
  await expect(page.locator('#publications-chart-status')).toContainText('3 PubMed articles');
  await expect(page.locator('#publications-chart li')).toHaveCount(3);
  const articles = page.locator('#publications-chart a');
  await expect(articles.first()).toHaveAttribute('aria-label', '2024: 1 PubMed articles. Browse source records.');
  await expect(articles.nth(1)).toHaveAttribute('aria-label', '2025: 0 PubMed articles. Browse source records.');
  await articles.last().focus();
  await expect(page.locator('#publications-chart-detail')).toHaveText('2026: 2 PubMed articles');
  await expect(articles.last()).toHaveAttribute('href', 'https://pubmed.ncbi.nlm.nih.gov/?term=Delftia+AND+2026%5Bdp%5D');
  await page.getByLabel('Year order').selectOption('descending');
  await expect(articles.first()).toContainText('2026');
  await page.locator('#genomes-chart a').first().hover();
  await expect(page.locator('#genomes-chart-detail')).toContainText('1 genome assemblies');
  await page.getByLabel('Species order').selectOption('ascending');
  await expect(page.locator('#genomes-chart a').first()).toContainText('Delftia acidovorans');
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).fill('no matches');
  await expect(page.locator('#publications-chart li')).toHaveCount(3);
  await expect(page.locator('#genomes-chart li')).toHaveCount(2);
});

test('genome chart groups all assemblies rather than the ten latest records', async ({ page }) => {
  await mockFeeds(page);
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => route.fulfill({ json: [
    ...Array.from({ length: 12 }, (_, index) => ({
      assembly_accession: `GCA_${index}`, scientific_name: 'Delftia acidovorans', last_updated: '2026-01-01',
    })),
    { assembly_accession: 'GCA_other', scientific_name: 'Delftia tsuruhatensis', last_updated: '2026-01-01' },
    { assembly_accession: 'GCA_0', scientific_name: 'Delftia acidovorans' },
    { scientific_name: 'Not an assembly' },
  ] }));
  await page.goto('/dashboard.html');
  await expect(page.locator('#genomes-list li')).toHaveCount(10);
  await expect(page.locator('#genomes-chart-status')).toContainText('13 assembly records across 2 scientific names');
  await expect(page.locator('#genomes-chart a').first()).toHaveAttribute('aria-label',
    'Delftia acidovorans: 12 genome assemblies. Browse source records.');
  const url = new URL(await page.locator('#genomes-chart a').first().getAttribute('href'));
  expect(url.searchParams.get('query')).toBe('tax_tree(80865) AND scientific_name="Delftia acidovorans"');
});

test('chart failures are independent and refresh clears stale graphs', async ({ page }) => {
  await mockFeeds(page, { failChart: true });
  await page.goto('/dashboard.html');
  await expect(page.locator('#publications-chart-status')).toContainText('Unable to load');
  await expect(page.locator('#genomes-chart li')).toHaveCount(2);
  await expect(page.locator('#publications-list li')).toHaveCount(1);
  await page.unrouteAll({ behavior: 'wait' });
  await mockFeeds(page);
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('#publications-chart-status')).toContainText('3 PubMed articles');
  await page.unrouteAll({ behavior: 'wait' });
  await mockFeeds(page, { failChart: true, failGenomes: true });
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('#genomes-chart-status')).toContainText('Unable to load');
  await expect(page.locator('.dashboard-chart li')).toHaveCount(0);
  await expect(page.locator('#publications-chart-detail')).toBeEmpty();
});

test('incomplete counts never display as complete annual totals', async ({ page }) => {
  await mockFeeds(page);
  await page.route('https://www.ebi.ac.uk/europepmc/webservices/rest/search?**', async route => {
    if (new URL(route.request().url()).searchParams.get('query') !== 'Delftia AND SRC:MED') return route.fallback();
    return route.fulfill({ json: { hitCount: 5, resultList: { result: [{ pubYear: '2026' }] } } });
  });
  await page.goto('/dashboard.html');
  await expect(page.locator('#publications-chart-status')).toContainText('Unable to load');
  await expect(page.locator('#publications-chart li')).toHaveCount(0);
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

test('people page identifies the alumni section without guessing names', async ({ page }) => {
  await page.goto('/people.html');
  await expect(page.getByRole('heading', { name: 'Lab Alumni' })).toBeVisible();
  await expect(page.getByText('do not yet identify former lab members by name')).toBeVisible();
});
