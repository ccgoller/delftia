const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const endpoint = 'https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/80865/dataset_report?**';
const records = [
  {
    accession: 'GCA_000001.1',
    organism: { organism_name: 'Delftia acidovorans', infraspecific_names: { strain: 'Alpha' } },
    assembly_info: { assembly_name: 'Alpha genome', assembly_level: 'Complete Genome', release_date: '2025-01-01' },
    assembly_stats: { total_sequence_length: '6270000', gc_percent: 66.79, number_of_contigs: 1, contig_n50: '6270000' },
  },
  {
    accession: 'GCA_000002.1',
    organism: { organism_name: 'Delftia tsuruhatensis' },
    assembly_info: { assembly_name: 'Beta genome', assembly_level: 'Scaffold' },
    assembly_stats: { total_sequence_length: '6922195', gc_percent: 0 },
  },
  {
    accession: 'GCA_000003.2',
    organism: { organism_name: 'Delftia <script>alert(1)</script>' },
    assembly_info: { assembly_name: '<img src=x onerror=alert(1)>' },
  },
];

async function mockCatalog(page) {
  await page.route(endpoint, route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('filters.assembly_source')).toBe('genbank');
    expect(params.get('page_size')).toBe('1000');
    return route.fulfill({ json: params.get('page_token') === 'next'
      ? { reports: [records[2], records[0]], total_count: 4 }
      : { reports: records.slice(0, 2), next_page_token: 'next', total_count: 4 } });
  });
}

for (const theme of ['light', 'dark']) {
  test(`selects two genomes and compares accessible features in ${theme} mode`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
    await mockCatalog(page);
    await page.goto('/dashboard-genome-comparison.html');
    const first = page.getByRole('combobox', { name: 'First genome', exact: true });
    const second = page.getByRole('combobox', { name: 'Second genome', exact: true });
    const table = page.locator('#selected-genome-comparison');
    await expect(page.locator('#genome-selection-status')).toContainText('3 assemblies loaded');
    await expect(first.locator('option')).toHaveCount(4);
    await expect(table).toBeHidden();
    await first.selectOption('GCA_000001.1');
    await expect(table).toBeHidden();
    await second.selectOption('GCA_000002.1');
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['Feature', 'GCA_000001.1', 'GCA_000002.1']);
    await expect(table.getByRole('row', { name: /^Genome length/ })).toHaveText('Genome length6,270,000 bp6,922,195 bp');
    await expect(table.getByRole('row', { name: /^G\+C content/ })).toHaveText('G+C content66.79%0%');
    await expect(table.getByRole('row', { name: /^Strain/ })).toHaveText('StrainAlphaNot reported');
    await expect(table.getByRole('link', { name: 'View GCA_000001.1 on NCBI' }))
      .toHaveAttribute('href', 'https://www.ncbi.nlm.nih.gov/datasets/genome/GCA_000001.1/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations).toEqual([]);

    await second.selectOption('GCA_000001.1');
    await expect(table).toBeHidden();
    await expect(page.locator('#genome-selection-status')).toContainText('same assembly is selected twice');
    await second.selectOption('GCA_000003.2');
    await expect(table).toContainText('Delftia <script>alert(1)</script>');
    await expect(table.locator('script, img')).toHaveCount(0);
    await expect(table.getByRole('row', { name: /^Genome length/ })).toHaveText('Genome length6,270,000 bpNot reported');
    await first.selectOption('');
    await expect(table).toBeHidden();
  });
}

for (const failure of ['network', 'empty', 'single', 'invalid', 'pagination']) {
  test(`handles ${failure} catalog and allows retry`, async ({ page }) => {
    await page.route(endpoint, route => {
      if (failure === 'network') return route.abort();
      const data = {
        empty: { total_count: 0 },
        single: { reports: records.slice(0, 1) },
        invalid: { reports: {} },
        pagination: { reports: records, next_page_token: 'repeated' },
      }[failure];
      return route.fulfill({ json: data });
    });
    await page.goto('/dashboard-genome-comparison.html');
    const retry = page.getByRole('button', { name: 'Retry loading genomes' });
    await expect(retry).toBeVisible();
    await expect(page.locator('#genome-selectors')).toBeHidden();
    await expect(page.locator('#selected-genome-comparison')).toBeHidden();
    await expect(page.locator('#genome-comparison-table')).toContainText('6.27 Mb');
    await mockCatalog(page);
    await retry.click();
    await expect(page.getByRole('combobox', { name: 'First genome', exact: true })).toBeVisible();
    await expect(retry).toBeHidden();
  });
}

test('loading keeps selection hidden until the catalog is ready', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route(endpoint, async route => {
    await pending;
    return route.fulfill({ json: { reports: records } });
  });
  await page.goto('/dashboard-genome-comparison.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#genome-selection-status')).toContainText('Loading');
  await expect(page.locator('#genome-selectors')).toBeHidden();
  release();
  await expect(page.getByRole('combobox', { name: 'First genome', exact: true })).toBeVisible();
});

test('published comparison remains available without JavaScript', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: testInfo.project.use.viewport });
  const page = await context.newPage();
  await page.goto('/dashboard-genome-comparison.html');
  await expect(page.locator('#genome-selectors')).toBeHidden();
  await expect(page.locator('#genome-selection-status')).toContainText('requires JavaScript');
  await expect(page.getByRole('table')).toContainText('6,922,195 bp');
  await context.close();
});
