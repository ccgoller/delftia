const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const pages = ['index.html', 'about.html', 'news.html', 'references.html'];

async function ready(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  });
}

async function checkStyles(page, theme) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('body')).toHaveCSS('background-color',
    theme === 'dark' ? 'rgb(15, 13, 10)' : 'rgb(255, 255, 255)');
  for (const card of await page.locator('.feature-card, .news-card, .team-card, .timeline-card, .ref-list li').all()) {
    await expect(card).toHaveCSS('background-color',
      theme === 'dark' ? 'rgb(36, 27, 19)' : 'rgb(255, 255, 255)');
  }
  for (const icon of await page.locator('.feature-card .card-icon').all()) {
    await expect(icon).toHaveCSS('background-color',
      theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
  }
  for (const heading of await page.locator('.hero-section h1, .cta-section h2').all()) {
    await expect(heading).toBeVisible();
    const color = await heading.evaluate(element => getComputedStyle(element).color);
    expect(color).not.toBe('rgb(10, 8, 5)');
  }
  // The decorative hero overlays must stay behind direct-child headings/subtitles.
  for (const content of await page.locator('.hero-section > h1, .hero-section > p').all()) {
    expect(await content.evaluate(element => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(1);
  }
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(results.violations).toEqual([]);
}

for (const path of pages) {
  for (const theme of ['light', 'dark']) {
    test(`${path} explicit ${theme} overrides opposite system theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.addInitScript(value => {
        if (!sessionStorage.getItem('test-theme-initialized')) {
          localStorage.setItem('delftia-theme', value);
          sessionStorage.setItem('test-theme-initialized', 'true');
        }
      }, theme);
      await page.goto(`/${path}`);
      await ready(page);
      await checkStyles(page, theme);
      await expect(page).toHaveScreenshot(`${path}-${theme}.png`, { fullPage: true });

      if (test.info().project.name === 'mobile') {
        await page.locator('.navbar-toggler').click();
      }
      await page.getByRole('button', { name: `Switch to ${theme === 'light' ? 'dark' : 'light'} mode` }).click();
      const toggled = theme === 'light' ? 'dark' : 'light';
      await checkStyles(page, toggled);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', toggled);
    });
  }
}

test('system preference follows changes until an explicit choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  if (test.info().project.name === 'mobile') await page.locator('.navbar-toggler').click();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('CSS system fallback works without JavaScript', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: 'dark',
    viewport: testInfo.project.use.viewport,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8000/index.html');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(15, 13, 10)');
  await context.close();
});

test('invalid saved preferences use system preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('delftia-theme', 'invalid'));
  await page.goto('/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('theme selection works when storage is blocked', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
  });
  await page.goto('/index.html');
  if (test.info().project.name === 'mobile') await page.locator('.navbar-toggler').click();
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Reading focus', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-reading-focus', 'true');
});

for (const path of pages) {
  for (const theme of ['light', 'dark']) {
    test(`${path} reading focus in ${theme} is accessible and persistent`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('delftia-theme', value), theme);
      await page.goto(`/${path}`);
      await ready(page);
      const button = page.getByRole('button', { name: 'Reading focus', exact: true });
      // Display preferences remain reachable without expanding mobile navigation.
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await button.focus();
      await page.keyboard.press('Space');
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-reading-focus', 'true');
      await checkStyles(page, theme);
      expect(await page.locator('#quarto-document-content').evaluate(element =>
        parseFloat(getComputedStyle(element).fontSize) /
        parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(1.125);
      for (const grid of await page.locator('.card-grid, .news-grid, .team-grid, .research-spotlight').all()) {
        expect(await grid.evaluate(element =>
          getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
      }
      await expect(page).toHaveScreenshot(`${path}-${theme}-reading.png`, { fullPage: true });
      await page.reload();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('link', { name: 'Home', exact: true }).last().click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('html')).toHaveAttribute('data-reading-focus', 'false');
    });
  }
}

test('display controls and cards reflow on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/index.html');
  await expect(page.getByRole('button', { name: 'Reading focus', exact: true })).toBeVisible();
  await checkStyles(page, 'light');
});

test('navbar logo scales down on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html');
  const logo = page.locator('.navbar-brand .navbar-logo');
  const desktopWidth = await logo.evaluate(element => element.getBoundingClientRect().width);
  await page.setViewportSize({ width: 320, height: 740 });
  const mobileBox = await logo.evaluate(element => {
    const { width, height } = element.getBoundingClientRect();
    return { width, height };
  });
  expect(mobileBox.width).toBeLessThan(desktopWidth);
  expect(mobileBox.width).toBeLessThanOrEqual(48);
  expect(mobileBox.height).toBeLessThanOrEqual(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('invalid reading preference is off by default', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('delftia-reading-focus', 'invalid'));
  await page.goto('/index.html');
  await expect(page.getByRole('button', { name: 'Reading focus', exact: true }))
    .toHaveAttribute('aria-pressed', 'false');
});
