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
    expect(params.get('fields')).toBe('assembly_accession,assembly_name,scientific_name,first_public,last_updated');
    return route.fulfill({ json: empty ? [] : [
      { accession: 'GCA_000001', assembly_name: 'Alpha assembly', scientific_name: 'Delftia acidovorans', first_public: '2023-01-01', last_updated: '2025-01-01' },
      { accession: 'GCA_000002', assembly_name: 'Beta assembly', scientific_name: 'Delftia tsuruhatensis', first_public: '2026-01-01', last_updated: '2026-10-02' },
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
        await expect(page.locator('#genomes-count')).toHaveCSS('color', 'rgb(232, 149, 75)');
        await expect(page.locator('#genomes-count')).toHaveCSS('background-color', 'rgb(26, 20, 16)');
        await expect(page.locator('#genomes-chart .dashboard-chart-count').first()).toHaveCSS('color', 'rgb(255, 218, 115)');
        await expect(page.locator('#genomes-chart .dashboard-chart-bar').first()).toHaveCSS('background-image',
          'linear-gradient(110deg, rgb(232, 149, 75), rgb(255, 218, 115))');
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

test('assembly names and dates can be sorted without refetching and retain filtering', async ({ page }) => {
  await mockFeeds(page);
  await page.goto('/dashboard.html');
  const assemblies = page.locator('#genomes-list li');
  await expect(assemblies.first()).toContainText('Beta assembly');
  await page.getByLabel('Assembly order').selectOption('oldest');
  await expect(assemblies.first()).toContainText('Alpha assembly');
  await page.getByLabel('Assembly order').selectOption('name');
  await expect(assemblies.first()).toContainText('Alpha assembly');
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).fill('Beta assembly');
  await page.getByLabel('Assembly order').selectOption('newest');
  await expect(page.locator('#genomes-list li:visible')).toHaveCount(1);
  await expect(page.locator('#genomes-list li:visible')).toContainText('GCA_000002');
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByRole('button', { name: 'Refresh dashboard' })).toBeEnabled();
  await expect(page.locator('#genomes-list li:visible')).toHaveCount(1);
  await expect(assemblies.first()).toContainText('Beta assembly');
});

test('assembly sorting keeps undated records last and renders names safely', async ({ page }) => {
  await mockFeeds(page);
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => route.fulfill({ json: [
    { assembly_accession: 'GCA_missing', assembly_name: '<script>alert(1)</script>' },
    { assembly_accession: 'GCA_old', scientific_name: 'Delftia acidovorans', last_updated: '2024-01-01' },
    { assembly_accession: 'GCA_new', scientific_name: 'Delftia acidovorans', last_updated: '2026-01-01' },
  ] }));
  await page.goto('/dashboard.html');
  const assemblies = page.locator('#genomes-list li');
  await expect(assemblies.first()).toContainText('GCA_new');
  await expect(assemblies.last()).toContainText('<script>alert(1)</script>');
  await expect(page.locator('#genomes-list script')).toHaveCount(0);
  await expect(assemblies.last()).toContainText('Date unavailable');
  await page.getByLabel('Assembly order').selectOption('oldest');
  await expect(assemblies.first()).toContainText('GCA_old');
  await expect(assemblies.last()).toContainText('GCA_missing');
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
  await expect(page.locator('#growth-chart-status')).toHaveText('No dated records available for the annual graph.');
  await expect(page.locator('#growth-chart-controls')).toBeHidden();
});

test('annual line graph counts first-public years, fills gaps, and supports interaction', async ({ page }) => {
  await mockFeeds(page);
  await page.goto('/dashboard.html');
  const graph = page.locator('#growth-chart');
  await expect(page.locator('#growth-chart-controls')).toBeVisible();
  await expect(graph.locator('.growth-series')).toHaveCount(3);
  for (const [series, color] of [
    ['publications', 'rgb(232, 149, 75)'], ['genomes', 'rgb(176, 176, 176)'], ['cumulative', 'rgb(255, 218, 115)'],
  ]) {
    await expect(graph.locator(`.growth-${series} polyline`)).toHaveCSS('stroke', color);
    await expect(graph.locator(`.growth-${series} circle`)).toHaveCount(4);
  }
  await expect(page.locator('#growth-chart-detail')).toHaveText('2026: 2 publications, 1 genomes, 2 cumulative genomes.');
  const slider = page.getByRole('slider', { name: 'Inspect year' });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', '2023');
  await expect(page.locator('#growth-chart-detail')).toHaveText('2023: 0 publications, 1 genomes, 1 cumulative genomes.');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#growth-chart-detail')).toHaveText('2024: 1 publications, 0 genomes, 1 cumulative genomes.');
  await graph.locator('rect').nth(2).dispatchEvent('pointerenter');
  await expect(page.locator('#growth-chart-detail')).toHaveText('2025: 0 publications, 0 genomes, 1 cumulative genomes.');
  await graph.locator('rect').last().dispatchEvent('pointerdown');
  await expect(slider).toHaveAttribute('aria-valuetext', '2026');
  await page.getByRole('checkbox', { name: 'Cumulative genomes', exact: true }).uncheck();
  await expect(graph.locator('.growth-cumulative')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Genomes', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Publications', exact: true }).uncheck();
  await expect(graph.locator('.growth-series')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Genomes', exact: true }).check();
  await expect(graph.locator('.growth-genomes')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).fill('no matches');
  await expect(graph.locator('.growth-genomes circle')).toHaveCount(4);
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByRole('button', { name: 'Refresh dashboard' })).toBeEnabled();
  await expect(graph.locator('.growth-series')).toHaveCount(1);
  await expect(page.locator('#growth-chart-detail')).toContainText('2 cumulative genomes');
});

test('annual genome counts deduplicate and exclude invalid first-public dates without using updates', async ({ page }) => {
  await mockFeeds(page);
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => route.fulfill({ json: [
    ...Array.from({ length: 12 }, (_, index) => ({ assembly_accession: `GCA_${index}`, first_public: '2024-01-01' })),
    { assembly_accession: 'GCA_0', first_public: '2024-01-01' },
    { assembly_accession: 'GCA_missing', last_updated: '2026-01-01' },
    { assembly_accession: 'GCA_invalid', first_public: '2025-99-99' },
    { assembly_accession: 'GCA_impossible', first_public: '2025-02-30' },
    { assembly_accession: 'GCA_future', first_public: '9999-01-01' },
    { first_public: '2024-01-01' },
  ] }));
  await page.goto('/dashboard.html');
  await expect(page.locator('#growth-chart-status')).toContainText('4 assemblies without a valid first-public date excluded');
  await expect(page.locator('#growth-chart-detail')).toHaveText('2026: 2 publications, 0 genomes, 12 cumulative genomes.');
  await page.getByRole('slider', { name: 'Inspect year' }).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#growth-chart-detail')).toHaveText('2024: 1 publications, 12 genomes, 12 cumulative genomes.');
});

test('annual graph handles a single year and failed refresh without stale lines', async ({ page }) => {
  await mockFeeds(page);
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => route.fulfill({ json: [
    { assembly_accession: 'GCA_one', first_public: '2026-01-01' },
  ] }));
  await page.route('https://www.ebi.ac.uk/europepmc/webservices/rest/search?**', route => {
    if (new URL(route.request().url()).searchParams.get('query') !== 'Delftia AND SRC:MED') return route.fallback();
    return route.fulfill({ json: { hitCount: 1, resultList: { result: [{ pubYear: '2026' }] } } });
  });
  await page.goto('/dashboard.html');
  await expect(page.locator('#growth-chart .growth-series circle')).toHaveCount(3);
  await expect(page.locator('#growth-chart-detail')).toHaveText('2026: 1 publications, 1 genomes, 1 cumulative genomes.');
  await page.unrouteAll({ behavior: 'wait' });
  await mockFeeds(page, { failChart: true });
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('#growth-chart-status')).toContainText('Unable to load');
  await expect(page.locator('#growth-chart-controls')).toBeHidden();
  await expect(page.locator('#growth-chart .growth-series')).toHaveCount(0);
  await expect(page.locator('#growth-chart-detail')).toBeEmpty();
  await page.unrouteAll({ behavior: 'wait' });
  await mockFeeds(page, { failGenomes: true });
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.getByRole('button', { name: 'Refresh dashboard' })).toBeEnabled();
  await expect(page.locator('#growth-chart-status')).toContainText('Unable to load');
  await page.unrouteAll({ behavior: 'wait' });
  await mockFeeds(page);
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('#growth-chart .growth-series')).toHaveCount(3);
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
  await page.getByLabel('Species order').selectOption('newest');
  await expect(page.locator('#genomes-chart a').first()).toContainText('Delftia tsuruhatensis');
  await page.getByLabel('Species order').selectOption('oldest');
  await expect(page.locator('#genomes-chart a').first()).toContainText('Delftia acidovorans');
  await page.getByRole('searchbox', { name: 'Filter loaded records' }).fill('no matches');
  await expect(page.locator('#publications-chart li')).toHaveCount(3);
  await expect(page.locator('#genomes-chart li')).toHaveCount(2);
});

test('genome chart groups all assemblies rather than the ten latest records', async ({ page }) => {
  await mockFeeds(page);
  await page.route('https://www.ebi.ac.uk/ena/portal/api/search?**', route => route.fulfill({ json: [
    ...Array.from({ length: 12 }, (_, index) => ({
      assembly_accession: `GCA_${index}`, scientific_name: 'Delftia acidovorans',
      last_updated: `2026-01-${String(index + 1).padStart(2, '0')}`,
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
  await expect(page.locator('#genomes-list li').first()).toContainText('GCA_11');
  await page.getByLabel('Assembly order').selectOption('oldest');
  await expect(page.locator('#genomes-list li').first()).toContainText('GCA_0');
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
