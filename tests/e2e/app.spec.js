import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

for (const width of [360, 768, 1280]) {
  test(`companies and catalog are usable at ${width}px`, async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Bridge the Gap/i })).toBeVisible();
    await expect(page.locator('.brand-badge, .hero-pill')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/YOUTH 16|16-25|16–25|Built for Students|Young Job Seekers/i);
    const [internships, courses, companies] = await Promise.all([
      page.request.get('/data/seed/internships.json').then(response => response.json()),
      page.request.get('/data/seed/courses.json').then(response => response.json()),
      page.request.get('/data/seed/companies.json').then(response => response.json())
    ]);
    const visibleInternships = internships.filter(internship => internship.isDemo !== true);
    await expect(page.locator('#hero-internship-count')).toHaveText(`${visibleInternships.length} internship programs`);
    await expect(page.locator('#home-stats-banner .stat-value').nth(0)).toHaveText(String(visibleInternships.length));
    await expect(page.locator('#home-stats-banner .stat-value').nth(1)).toHaveText(String(courses.length));
    await expect(page.locator('#home-stats-banner .stat-value').nth(2)).toHaveText('0');
    await expect(page.locator('#home-stats-banner .stat-value').nth(3)).toHaveText('0');
    const initialTheme = await page.locator('html').getAttribute('data-theme');
    await page.locator('#theme-toggle-btn').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', initialTheme);
    await page.locator('#theme-toggle-btn').click();
    await page.locator('[data-route="companies"]:visible').first().click();
    await expect(page.getByRole('heading', { name: 'Companies & Programs' })).toBeVisible();
    await expect(page.locator('#companies-result-count')).toContainText(String(companies.length));
    await page.locator('#company-search-input').fill('zoho');
    await expect(page.locator('#companies-result-count')).toContainText(`1 of ${companies.length}`);
    await expect(page.locator('.company-card')).toContainText('Zoho');
    await expect(page.locator('html').evaluate(node => node.scrollWidth)).resolves.toBeLessThanOrEqual(width);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('filters sync to URL and remaining routes and guest login render', async ({ page }) => {
  await page.goto('/?q=ml#internships');
  await expect(page.locator('#internship-search-input')).toHaveValue('ml');
  await page.locator('#filter-field').selectOption('Software Engineering');
  await expect(page).toHaveURL(/field=Software\+Engineering/);
  await page.locator('#filter-state').selectOption('Maharashtra');
  await page.locator('#filter-location').selectOption('Mumbai');
  await expect(page).toHaveURL(/city=Mumbai/);
  await page.locator('#filter-mode').selectOption('Remote');
  await expect(page).toHaveURL(/mode=Remote/);
  await page.locator('#filter-duration').selectOption('3');
  await page.locator('#filter-comp').selectOption('unknown');
  await page.locator('#filter-stipend-range').selectOption('under-10000');
  await page.locator('#filter-company-type').selectOption('MNC');
  await page.locator('#filter-eligibility').selectOption('Undergraduate');
  await page.locator('#filter-verified').check();
  await page.locator('#filter-deadline-soon').check();
  await page.locator('#btn-clear-filters').click();
  await expect(page).not.toHaveURL(/(?:q|field|state|city|mode|duration|paid|stipend|type|eligibility|verified|deadlineSoon)=/);
  await page.locator('#auth-action-btn').click();
  if (process.env.VITE_USE_AUTH_EMULATOR === 'true') {
    await expect(page.locator('.auth-config-note')).toContainText('Sign in to sync your profile');
    await expect(page.locator('#auth-google')).toBeEnabled();
  } else {
    await expect(page.locator('.auth-config-note')).toContainText('unavailable right now');
    await expect(page.locator('.auth-config-note')).not.toContainText('VITE_FIREBASE_API_KEY');
    await expect(page.locator('#auth-google')).toBeDisabled();
    await expect(page.locator('#auth-submit')).toBeDisabled();
  }
  await page.locator('#auth-guest').click();
  await page.goto('/#tracker');
  await expect(page.getByRole('heading', { name: /Application Tracker/i })).toBeVisible();
  await page.goto('/#courses');
  await expect(page.getByRole('heading', { name: 'Skills & Courses' })).toBeVisible();
  await page.goto('/#videos');
  await expect(page.getByRole('heading', { name: 'Video Classes' })).toBeVisible();
  await page.goto('/#profile');
  await expect(page.getByRole('heading', { name: 'Student Profile' })).toBeVisible();
});

test('demo visibility, company filters, details, and demo apply safety', async ({ page }) => {
  const [companies, internships] = await Promise.all([
    page.request.get('/data/seed/companies.json').then(response => response.json()),
    page.request.get('/data/seed/internships.json').then(response => response.json())
  ]);
  const realCompanies = companies.filter(company => company.isDemo !== true);
  const demoCompany = companies.find(company => company.isDemo === true);
  const regionalCompanies = realCompanies.filter(company =>
    company.state === 'Karnataka' && company.city === 'Bengaluru');
  const realInternshipCompanyIds = new Set(internships
    .filter(internship => internship.isDemo !== true)
    .map(internship => internship.companyId));

  await page.goto('/#companies');
  await expect(page.locator('#companies-result-count'))
    .toHaveText(`Showing ${realCompanies.length} of ${companies.length} organizations`);
  await page.locator('#company-state-filter').selectOption('Karnataka');
  await page.locator('#company-city-filter').selectOption('Bengaluru');
  await expect(page.locator('#companies-result-count'))
    .toHaveText(`Showing ${regionalCompanies.length} of ${companies.length} organizations`);
  await page.locator('#company-has-internships').check();
  const regionalWithInternships = regionalCompanies.filter(company =>
    realInternshipCompanyIds.has(company.id));
  await expect(page.locator('#companies-result-count'))
    .toHaveText(`Showing ${regionalWithInternships.length} of ${companies.length} organizations`);

  await page.locator('#company-reset-filters').click();
  await page.locator('#company-include-demo').check();
  await expect(page.locator('#companies-result-count'))
    .toHaveText(`Showing ${companies.length} of ${companies.length} organizations`);
  await page.locator('#company-search-input').fill(demoCompany.name);
  const demoCompanyCard = page.locator('.company-card').filter({ hasText: demoCompany.name });
  await expect(demoCompanyCard).toContainText('Demo data');
  await demoCompanyCard.locator('[data-company-details]').click();
  const modal = page.locator('#global-modal-dialog');
  await expect(modal).toContainText(demoCompany.name);
  await expect(modal).toContainText('Demo data');
  await expect(modal.locator('[data-company-program]')).toHaveCount(2);
  await modal.locator('[data-company-program]').first().click();
  await expect(page.locator('#global-modal-dialog')).toContainText('Demo only - no application link');
  await expect(page.locator('#modal-apply-btn')).toHaveCount(0);
});

test('capture catalog layouts for desktop and mobile in dark and light themes', async ({ page }) => {
  const reportDirectory = resolve('reports');
  await mkdir(reportDirectory, { recursive: true });
  for (const width of [360, 768, 1280]) {
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.evaluate(value => localStorage.setItem('skillbridge_theme', JSON.stringify(value)), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.goto('/#companies');
      await page.screenshot({
        path: resolve(reportDirectory, `companies-${theme}-${width}.png`),
        fullPage: true
      });
      await page.goto('/#internships');
      await page.screenshot({
        path: resolve(reportDirectory, `internships-${theme}-${width}.png`),
        fullPage: true
      });
      await expect(page.locator('html').evaluate(node => node.scrollWidth))
        .resolves.toBeLessThanOrEqual(width);
    }
  }
});

test('home activity stats reflect saved tracker and course progress', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('skillbridge_applications', JSON.stringify([
      { id: 'application-applied', internshipId: 'internship-a', status: 'Applied', notes: '' },
      { id: 'application-interview', internshipId: 'internship-b', status: 'Interview', notes: '' },
      { id: 'application-saved', internshipId: 'internship-c', status: 'Saved', notes: '' }
    ]));
    localStorage.setItem('skillbridge_completed_courses', JSON.stringify(['course-a', 'course-b']));
  });
  await page.goto('/');
  await expect(page.locator('#home-stats-banner .stat-value').nth(2)).toHaveText('2');
  await expect(page.locator('#home-stats-banner .stat-value').nth(3)).toHaveText('2');
});

test('video tabs, topic filters, language filters, and aliases work', async ({ page }) => {
  await page.goto('/#videos');
  await expect(page.locator('#video-classes-list .video-class-card')).toHaveCount(128);

  await page.locator('#video-tab-skills').click();
  await expect(page.locator('#video-tab-skills')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#video-classes-list')).toContainText('static edition does not include');

  await page.locator('#video-tab-prep').click();
  await page.getByRole('button', { name: 'Resume & CV' }).click();
  await expect(page.locator('#video-classes-list .video-class-card')).toHaveCount(11);
  await page.locator('#video-language-filter').selectOption('Hindi');
  await expect(page.locator('#video-classes-list .video-class-card')).toHaveCount(4);
  await page.locator('#video-search').fill('cv');
  await expect(page.locator('#video-classes-list .video-class-card')).toHaveCount(4);
  await page.locator('#video-level-filter').selectOption('Intermediate');
  await expect(page.locator('#video-classes-list .video-class-card')).toHaveCount(0);
});

test('video duration filters show videos with verified durations', async ({ page }) => {
  await page.goto('/#videos');
  await page.locator('#video-duration-filter').selectOption('under-10');
  await expect(page.locator('#video-classes-list .video-class-card').first()).toBeVisible();
  await expect(page.locator('#video-result-count')).toContainText('classes found');
  await page.locator('#video-duration-filter').selectOption('over-30');
  await expect(page.locator('#video-classes-list .video-class-card').first()).toBeVisible();
});

for (const width of [360, 768, 1280]) {
  test(`video classes fit the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#videos');
    await expect(page.locator('#video-classes-list .video-class-card')).toHaveCount(128);
    await expect(page.locator('html').evaluate(node => node.scrollWidth))
      .resolves.toBeLessThanOrEqual(width);
  });
}

test('video modal is keyboard accessible and closes on Escape', async ({ page }) => {
  await page.goto('/#videos');
  const openButton = page.locator('#video-classes-list [data-video-open]').first();
  await openButton.focus();
  await page.keyboard.press('Enter');
  const overlay = page.locator('#global-modal-overlay');
  await expect(overlay).toHaveAttribute('aria-hidden', 'false');
  await expect(overlay).toContainText('not a verified video');

  const closeButton = overlay.locator('[data-close-modal]');
  await expect(closeButton).toBeVisible();
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(overlay.locator('#modal-video-watched')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await expect(openButton).toBeFocused();
});

test('watched video state persists after reload for guests', async ({ page }) => {
  await page.goto('/#videos');
  await page.evaluate(() => localStorage.removeItem('skillbridge_watched_videos'));
  await page.reload();
  const firstCard = page.locator('#video-classes-list .video-class-card').first();
  const watchButton = firstCard.locator('[data-video-watch]');
  await watchButton.click();
  await expect(watchButton).toHaveText('Watched ✓');
  const saveButton = firstCard.locator('[data-video-save]');
  await saveButton.click();
  await expect(saveButton).toHaveText('Saved ✓');
  await page.reload();
  await expect(page.locator('#video-classes-list .video-class-card').first()
    .locator('[data-video-watch]')).toHaveText('Watched ✓');
  await expect(page.locator('#video-classes-list .video-class-card').first()
    .locator('[data-video-save]')).toHaveText('Saved ✓');
});

test('verified video modal uses privacy-enhanced embed', async ({ page }) => {
  await page.goto('/#videos');
  await page.locator('[data-video-open="prep-081"]').click();
  await expect(page.locator('#global-modal-dialog iframe'))
    .toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/3TqQF-YAlNg');
  await expect(page.locator('#global-modal-dialog iframe'))
    .toHaveAttribute('title', /How to Spot a Fake Internship/);
});

test('video modal explains offline playback', async ({ page, context }) => {
  await page.goto('/#videos');
  await expect(page.locator('#video-classes-list [data-video-open]').first()).toBeVisible();
  await context.setOffline(true);
  await page.locator('#video-classes-list [data-video-open]').first().click();
  await expect(page.locator('#global-modal-overlay'))
    .toContainText('You appear to be offline');
});

test('internship details show up to three matching preparation videos', async ({ page }) => {
  const internship = {
    id: 'e2e-frontend-internship',
    title: 'Frontend Development Intern',
    companyId: 'example-labs',
    companyName: 'Example Labs',
    field: 'Software Engineering',
    skills: ['GitHub', 'README', 'JavaScript'],
    city: 'Bengaluru',
    state: 'Karnataka',
    mode: 'Remote',
    durationMonths: 3,
    stipendMin: 10000,
    stipendMax: 15000,
    isPaid: true,
    eligibility: 'Undergraduate',
    companyType: 'Startup',
    applyUrl: 'https://example.com/careers',
    source: 'https://example.com',
    verified: true,
    lastVerified: '2026-11-10',
    deadline: '2026-12-01',
    description: 'Build accessible web tools.',
    searchTokens: [],
    responsibilities: [],
    requirements: [],
    perks: []
  };
  await page.route('**/js/data.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const INTERNSHIPS = ${JSON.stringify([internship])};
      export const COURSES = [];
      export const ALL_SKILLS = [];
      export const DEFAULT_PROFILE = { name: '', headline: '', location: '', email: '', phone: '', bio: '', interests: [], skills: [], completedCourses: [] };`
  }));
  await page.goto('/#internships');
  await expect(page.locator('.internship-card')).toHaveCount(1);
  await page.locator('.internship-card [data-action="view-details"]').click();
  await expect(page.locator('#global-modal-dialog')).toContainText('Prepare for this internship');
  await expect(page.locator('.internship-video-recommendation')).toHaveCount(3);
  await expect(page.locator('.internship-video-recommendation').first())
    .toContainText('GitHub & portfolio');
});

test('new schema entries show unknown fields and verification details safely', async ({ page }) => {
  await page.goto('/#internships');
  await page.locator('#internship-search-input').fill('Prime Minister Internship Scheme');
  await expect(page.locator('.internship-card')).toHaveCount(1);
  await expect(page.locator('.internship-card').first()).toContainText('Check official site');

  await page.locator('.internship-card [data-action="view-details"]').first().click();
  const modal = page.locator('#global-modal-dialog');
  await expect(modal).toContainText('Check official site');
  await expect(modal.locator('a[href="https://pminternship.mca.gov.in/"]')).toContainText('Official source');
});

test('internship aliases and filters match the official catalog records', async ({ page }) => {
  await page.goto('/#internships');
  await page.locator('#internship-search-input').fill('govt');
  await expect(page.locator('.internship-card').filter({ hasText: 'PM Internship Scheme' })).toHaveCount(1);

  await page.locator('#internship-search-input').fill('sde');
  await expect(page.locator('.internship-card').filter({ hasText: 'Google Summer of Code' })).toHaveCount(1);

  await page.locator('#internship-search-input').fill('');
  await page.locator('#filter-field').selectOption('Software Engineering');
  await expect(page.locator('.internship-card')).toHaveCount(1);
  await page.locator('#filter-company-type').selectOption('Program');
  await expect(page.locator('.internship-card')).toContainText('Google Summer of Code');
  await page.locator('#btn-clear-filters').click();
  await page.locator('#filter-comp').selectOption('unknown');
  await expect(page.locator('.internship-card').filter({ hasText: 'PM Internship Scheme' })).toHaveCount(1);
});
