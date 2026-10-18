const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const endpoint = 'https://api.ncbi.nlm.nih.gov/datasets/v2/genome/taxon/80865/dataset_report?**';
const genomes = [
  {
    accession: 'GCA_000001001.1',
    organism: { organism_name: 'Delftia acidovorans', infraspecific_names: { strain: 'Alpha' } },
    assembly_info: { assembly_name: 'Alpha assembly', assembly_level: 'Complete Genome', release_date: '2024-01-01' },
    assembly_stats: { total_sequence_length: '6500000', gc_percent: 66.5, number_of_contigs: 1, contig_n50: '6500000' },
  },
  {
    accession: 'GCA_000001002.1',
    organism: { organism_name: 'Delftia tsuruhatensis' },
    assembly_info: { assembly_name: 'Beta assembly', assembly_level: 'Scaffold' },
    assembly_stats: { total_sequence_length: '6900000', gc_percent: 66.45, number_of_contigs: 42 },
  },
  {
    accession: 'GCA_000001003.2',
    organism: { organism_name: 'Delftia tsuruhatensis' },
    assembly_info: { assembly_name: 'Gamma <script>alert(1)</script>' },
    assembly_stats: { total_sequence_length: null, gc_percent: '', number_of_contigs: 0 },
  },
];

async function mockGenomes(page, records = genomes) {
  await page.route(endpoint, route => route.fulfill({
    json: { reports: records, total_count: records.length },
  }));
}

test('selects two distinct genomes and updates sourced assembly statistics', async ({ page }) => {
  await mockGenomes(page);
  await page.goto('/dashboard-genome-comparison.html');
  const table = page.getByRole('region', { name: 'Selected genome comparison', exact: true });
  const first = page.getByLabel('First genome', { exact: true });
  const second = page.getByLabel('Second genome', { exact: true });
  await expect(first).toBeEnabled();
  await expect(first.locator('option')).toHaveCount(3);
  await expect(table).toContainText('6,500,000 bp');
  await expect(table).toContainText('6,900,000 bp');
  await expect(table).toContainText('66.5%');
  await expect(table.getByRole('link', { name: genomes[0].accession })).toHaveAttribute(
    'href', `https://www.ncbi.nlm.nih.gov/datasets/genome/${genomes[0].accession}/`);
  await expect(second.locator('option').first()).toBeDisabled();
  await expect(first.locator('option').nth(1)).toBeDisabled();
  await second.selectOption(genomes[2].accession);
  await expect(table).not.toContainText('6,900,000 bp');
  await expect(table).toContainText('Not reported');
  await expect(table.getByRole('row', { name: /^Contigs / })).toContainText('0');
  await expect(table).toContainText('Gamma <script>alert(1)</script>');
  await expect(table.locator('script')).toHaveCount(0);
  await expect(table.getByRole('row', { name: /^G\+C content / })).toContainText('Not reported');
  await expect(page.getByRole('status').filter({ hasText: 'Comparing' })).toContainText(genomes[2].accession);
  await first.selectOption(genomes[1].accession);
  await expect(table).not.toContainText('6,500,000 bp');
  await expect(table).toContainText('6,900,000 bp');
});

test('loads every page and deduplicates versioned accessions', async ({ page }) => {
  await page.route(endpoint, route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('filters.assembly_source')).toBe('genbank');
    expect(params.get('page_size')).toBe('1000');
    const next = params.get('page_token');
    return route.fulfill({ json: next
      ? { reports: [genomes[0], genomes[2]], total_count: 4 }
      : { reports: genomes.slice(0, 2), total_count: 4, next_page_token: 'next' } });
  });
  await page.goto('/dashboard-genome-comparison.html');
  await expect(page.getByLabel('First genome', { exact: true }).locator('option')).toHaveCount(3);
  await page.getByLabel('Second genome', { exact: true }).selectOption(genomes[2].accession);
  await expect(page.locator('#selected-genome-comparison')).toContainText(genomes[2].accession);
});

for (const theme of ['light', 'dark']) {
  test(`selectable comparison is accessible in ${theme} mode`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
    await mockGenomes(page);
    await page.goto('/dashboard-genome-comparison.html');
    await expect(page.locator('#selected-genome-comparison')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page })
      .include('section[aria-label="Select genomes to compare"]')
      .include('#selected-genome-comparison')
      .withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
    await page.getByLabel('First genome', { exact: true }).focus();
    await expect(page.getByLabel('First genome', { exact: true })).toBeFocused();
  });
}

for (const records of [[], genomes.slice(0, 1)]) {
  test(`handles ${records.length} available genomes`, async ({ page }) => {
    await mockGenomes(page, records);
    await page.goto('/dashboard-genome-comparison.html');
    await expect(page.locator('#genome-selection-status')).toContainText('Fewer than two');
    await expect(page.getByLabel('First genome', { exact: true })).toBeDisabled();
    await expect(page.locator('#selected-genome-comparison')).toBeHidden();
    await expect(page.locator('#genome-comparison-table')).toContainText('6.27 Mb');
  });
}

for (const failure of ['http', 'malformed', 'incomplete', 'repeated token', 'timeout']) {
  test(`recovers from ${failure} loading failure`, async ({ page }) => {
    await page.route(endpoint, route => {
      if (failure === 'http') return route.fulfill({ status: 503, body: 'Unavailable' });
      if (failure === 'timeout') return route.abort('timedout');
      if (failure === 'malformed') return route.fulfill({ json: { reports: {} } });
      return route.fulfill({ json: {
        reports: genomes, total_count: 4,
        ...(failure === 'repeated token' ? { next_page_token: 'repeat' } : {}),
      } });
    });
    await page.goto('/dashboard-genome-comparison.html');
    await expect(page.locator('#genome-selection-status')).toContainText('Unable to load');
    await expect(page.locator('#selected-genome-comparison')).toBeHidden();
    await expect(page.locator('#genome-comparison-table')).toContainText('6.27 Mb');
    await mockGenomes(page);
    await page.getByRole('button', { name: 'Retry loading genomes' }).click();
    await expect(page.locator('#selected-genome-comparison')).toContainText('6,500,000 bp');
    await expect(page.getByRole('button', { name: 'Retry loading genomes' })).toBeHidden();
  });
}

test('retains the published comparison without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/dashboard-genome-comparison.html');
  await expect(page.locator('#genome-selection-status')).toContainText('requires JavaScript');
  await expect(page.locator('#genome-selection-controls')).toBeHidden();
  await expect(page.locator('#genome-comparison-table')).toContainText('6,922,195 bp');
  await context.close();
});
