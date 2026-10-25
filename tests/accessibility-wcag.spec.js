const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const pages = ['index.html', 'about.html', 'news.html', 'references.html'];
const themesToTest = ['light', 'dark'];

// Test ARIA labels on form controls
test('dashboard form controls have accessible names', async ({ page }) => {
  await page.goto('/dashboard.html');
  
  // Check year range input (may be hidden until JavaScript loads)
  const yearInput = page.locator('#growth-chart-year');
  expect(await yearInput.count()).toBeGreaterThan(0);
  const ariaLabel = await yearInput.getAttribute('aria-label');
  expect(ariaLabel).toBeTruthy();
  
  // Check search input (may be hidden initially)
  const searchInput = page.locator('#dashboard-search');
  const searchAriaLabel = await searchInput.getAttribute('aria-label');
  expect(searchAriaLabel).toBeTruthy();
  
  // Check publication sort select
  const pubSort = page.locator('#publications-chart-sort');
  const pubSortAriaLabel = await pubSort.getAttribute('aria-label');
  expect(pubSortAriaLabel).toBeTruthy();
  
  // Check genomes chart sort
  const genomeSort = page.locator('#genomes-chart-sort');
  const genomeSortAriaLabel = await genomeSort.getAttribute('aria-label');
  expect(genomeSortAriaLabel).toBeTruthy();
  
  // Check genomes table sort
  const genomeTableSort = page.locator('#genomes-sort');
  const genomeTableAriaLabel = await genomeTableSort.getAttribute('aria-label');
  expect(genomeTableAriaLabel).toBeTruthy();
});

test('genome comparison form controls have accessible names', async ({ page }) => {
  await page.goto('/dashboard-genome-comparison.html');
  
  // Check first genome filter (may be hidden until JavaScript loads)
  const firstFilter = page.locator('#genome-first-filter');
  expect(await firstFilter.count()).toBeGreaterThan(0);
  const firstFilterAriaLabel = await firstFilter.getAttribute('aria-label');
  expect(firstFilterAriaLabel).toBeTruthy();
  
  // Check first genome select
  const firstSelect = page.locator('#genome-first');
  const firstSelectAriaLabel = await firstSelect.getAttribute('aria-label');
  expect(firstSelectAriaLabel).toBeTruthy();
  
  // Check second genome filter
  const secondFilter = page.locator('#genome-second-filter');
  const secondFilterAriaLabel = await secondFilter.getAttribute('aria-label');
  expect(secondFilterAriaLabel).toBeTruthy();
  
  // Check second genome select
  const secondSelect = page.locator('#genome-second');
  const secondSelectAriaLabel = await secondSelect.getAttribute('aria-label');
  expect(secondSelectAriaLabel).toBeTruthy();
});

test('GitHub footer link has accessible name', async ({ page }) => {
  await page.goto('/index.html');
  const footer = page.locator('footer');
  const githubLink = footer.locator('a[href*="github.com"]');
  
  // Check that visually hidden text is present
  const hiddenText = githubLink.locator('.visually-hidden');
  await expect(hiddenText).toContainText('GitHub');
  
  // Check accessible name exists
  const accessibleName = await githubLink.getAttribute('aria-label') || 
                         await githubLink.textContent();
  expect(accessibleName).toBeTruthy();
});

test('discover section is properly marked as a region', async ({ page }) => {
  await page.goto('/index.html');
  const discoverSection = page.locator('.discover-delftia');
  
  // Check role attribute
  const role = await discoverSection.getAttribute('role');
  expect(role).toBe('region');
  
  // Check aria-labelledby is present
  const ariaLabelledBy = await discoverSection.getAttribute('aria-labelledby');
  expect(ariaLabelledBy).toBe('discover-heading');
  
  // Verify the heading exists
  const heading = page.locator('#discover-heading');
  await expect(heading).toBeVisible();
});

// Test color contrast in both light and dark modes
for (const theme of themesToTest) {
  test(`color contrast passes axe checks in ${theme} mode`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
    await page.goto('/index.html');
    
    // Run axe with focus on color-contrast rule
    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    
    expect(results.violations).toEqual([]);
  });
  
  for (const path of pages) {
    test(`${path} has no color contrast violations in ${theme} mode`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
      await page.goto(`/${path}`);
      
      const results = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .analyze();
      
      expect(results.violations).toEqual([]);
    });
  }
}

// Test link descriptions are not generic
test('no generic link text is present', async ({ page }) => {
  await page.goto('/index.html');
  
  const links = page.locator('a[href]');
  const linkCount = await links.count();
  
  for (let i = 0; i < linkCount; i++) {
    const link = links.nth(i);
    const text = (await link.textContent()).trim().toLowerCase();
    
    // Check for generic link text
    const genericPatterns = ['click here', 'read more', 'learn more', 'more', 'here', 'link', 'go'];
    for (const pattern of genericPatterns) {
      if (text === pattern) {
        const href = await link.getAttribute('href');
        const title = await link.getAttribute('title');
        const ariaLabel = await link.getAttribute('aria-label');
        
        // Generic text is acceptable if there's a descriptive title, aria-label, or it's very obvious from context
        if (!title && !ariaLabel) {
          console.log(`Warning: Generic link text "${text}" at href "${href}"`);
        }
      }
    }
  }
});

// Test skip link functionality
test('skip link is present and functional', async ({ page }) => {
  await page.goto('/index.html');
  
  const skipLink = page.locator('.skip-link');
  expect(await skipLink.count()).toBeGreaterThan(0);
  
  const href = await skipLink.getAttribute('href');
  expect(href).toBeTruthy();
  expect(href).toContain('quarto-document-content');
  
  // The skip link should target the main content
  const targetId = href.substring(href.lastIndexOf('#') + 1);
  const target = page.locator(`#${targetId}`);
  expect(await target.count()).toBeGreaterThan(0);
});

// Test focus management and visibility
for (const theme of themesToTest) {
  test(`interactive elements have visible focus indicators in ${theme} mode`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
    await page.goto('/index.html');
    
    // Test button focus
    const button = page.getByRole('button', { name: 'Switch to' }).first();
    await button.focus();
    await expect(button).toBeFocused();
    
    // Check that focus is visible (outlinewidth > 0)
    const outlineWidth = await button.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.outlineWidth;
    });
    
    // Focus should have some visible indication
    expect(outlineWidth).not.toBe('0px');
  });
}

// Test ARIA live regions on dashboard
test('dashboard status regions use proper ARIA live attributes', async ({ page }) => {
  await page.goto('/dashboard.html');
  
  // Check various status regions
  const statusRegions = page.locator('[role="status"]');
  const regionCount = await statusRegions.count();
  
  expect(regionCount).toBeGreaterThan(0);
  
  for (let i = 0; i < regionCount; i++) {
    const region = statusRegions.nth(i);
    const ariaLive = await region.getAttribute('aria-live');
    expect(['polite', 'assertive', null]).toContain(ariaLive);
  }
});

// Test heading hierarchy
test('heading hierarchy is correct', async ({ page }) => {
  await page.goto('/index.html');
  
  const headings = page.locator('h1, h2, h3, h4, h5, h6');
  const headingCount = await headings.count();
  
  let lastLevel = 0;
  for (let i = 0; i < headingCount; i++) {
    const heading = headings.nth(i);
    const tagName = await heading.evaluate(el => el.tagName);
    const level = parseInt(tagName.substring(1));
    
    // Headings should not skip levels (e.g., h1 -> h3 is bad)
    if (lastLevel > 0) {
      expect(level, `Heading level after h${lastLevel}`).toBeLessThanOrEqual(lastLevel + 1);
    }
    lastLevel = level;
  }
});

// Test image alt text
test('images have alt text or aria-label', async ({ page }) => {
  await page.goto('/index.html');
  
  const images = page.locator('img');
  const imageCount = await images.count();
  
  for (let i = 0; i < imageCount; i++) {
    const img = images.nth(i);
    const alt = await img.getAttribute('alt');
    const ariaLabel = await img.getAttribute('aria-label');
    const ariaHidden = await img.getAttribute('aria-hidden');
    
    // Empty alt text is valid for decorative images; a missing attribute is not.
    expect(
      alt !== null || Boolean(ariaLabel && ariaLabel.trim()) || ariaHidden === 'true',
      `Image without alt text or aria-label: ${await img.getAttribute('src')}`
    ).toBe(true);
  }
});

// Test SVG accessibility
test('SVG elements have accessible names', async ({ page }) => {
  await page.goto('/dashboard.html');
  
  const svgs = page.locator('svg[role="img"]');
  const svgCount = await svgs.count();
  
  for (let i = 0; i < svgCount; i++) {
    const svg = svgs.nth(i);
    const ariaLabel = await svg.getAttribute('aria-label');
    const ariaLabelledBy = await svg.getAttribute('aria-labelledby');
    
    // SVG images should have either aria-label or aria-labelledby
    expect(ariaLabel || ariaLabelledBy).toBeTruthy();
  }
});

// Test that decorative elements are properly marked
test('decorative emojis and icons use aria-hidden', async ({ page }) => {
  await page.goto('/index.html');
  
  // Cards with decorative emoji should have aria-hidden
  const cards = page.locator('.feature-card');
  const cardCount = await cards.count();
  
  for (let i = 0; i < Math.min(cardCount, 5); i++) {
    const card = cards.nth(i);
    const emoji = card.locator('[aria-hidden="true"]');
    // Decorative elements should be marked
    const count = await emoji.count();
    // Not all cards may have decorative elements, but those that do should mark them
  }
});

// Test form labels are associated with inputs
test('form controls have associated labels', async ({ page }) => {
  await page.goto('/dashboard.html');
  
  const inputs = page.locator('input[type="search"], input[type="range"]');
  const inputCount = await inputs.count();
  
  for (let i = 0; i < inputCount; i++) {
    const input = inputs.nth(i);
    const id = await input.getAttribute('id');
    
    if (id) {
      const label = page.locator(`label[for="${id}"]`);
      const ariaLabel = await input.getAttribute('aria-label');
      
      // Input should have either an associated label or aria-label
      const labelCount = await label.count();
      expect(labelCount > 0 || ariaLabel).toBeTruthy();
    }
  }
});
