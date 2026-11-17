import { expect, test } from '@playwright/test';
import { stat } from 'node:fs/promises';

for (const width of [360, 768, 1280]) {
  test(`learning paths render without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#my-learning');
    await expect(page.getByRole('heading', { name: 'My Learning' })).toBeVisible();
    await expect(page.locator('#my-learning-paths .learning-path-card')).toHaveCount(7);
    await expect(page.locator('#my-learning-paths [data-path-quiz]').first()).toBeDisabled();
    await expect(page.locator('html').evaluate(node => node.scrollWidth))
      .resolves.toBeLessThanOrEqual(width);
  });
}

test('public verification displays valid, revoked, and unknown states safely', async ({ page }) => {
  const records = {
    'SB-2026-VALEDABCEFGH-AA': {
      status: 'valid',
      recipientName: '<img src=x onerror=window.__certificateXss=1>',
      pathTitle: '<script>window.__certificateXss=2</script>',
      issuedAt: '2026-11-11T00:00:00.000Z',
      issuer: 'SkillBridge'
    },
    'SB-2026-REVKEDABCEFG-BB': {
      status: 'revoked',
      recipientName: 'A Student',
      pathTitle: 'Python Foundations',
      issuedAt: '2026-11-11T00:00:00.000Z',
      issuer: 'SkillBridge'
    }
  };
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.pathname.includes('/certificates/verify/')) {
      await route.continue();
      return;
    }
    const certId = decodeURIComponent(requestUrl.pathname.split('/').pop());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(records[certId] || { status: 'not_found' })
    });
  });
  const answerKeyResponse = await page.request.get('/data/seed/paths.json');
  expect(answerKeyResponse.status()).toBe(404);
  await page.goto('/#verify');
  const input = page.locator('#public-cert-id');
  const result = page.locator('#certificate-verification-result');

  await input.fill('SB-2026-VALEDABCEFGH-AA');
  await page.locator('#public-verify-form button[type="submit"]').click();
  await expect(result).toContainText('Valid');
  await expect(result).toContainText('<img src=x onerror=window.__certificateXss=1>');
  await expect(result.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__certificateXss)).toBeUndefined();

  await input.fill('SB-2026-REVKEDABCEFG-BB');
  await page.locator('#public-verify-form button[type="submit"]').click();
  await expect(result).toContainText('Revoked · not valid');
  await expect(result).toContainText('Python Foundations');

  await input.fill('SB-2026-UNKNEXABCEFG-CC');
  await page.locator('#public-verify-form button[type="submit"]').click();
  await expect(result).toContainText('Not found');
  await expect(result).not.toContainText('A Student');
});

test('certificate PDF and image downloads create non-empty files', async ({ page }) => {
  await page.goto('/#my-learning');
  for (const action of ['downloadCertificatePdf', 'downloadCertificateImage']) {
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(async actionName => {
      const { [actionName]: download } = await import('/client/src/services/certificates.js');
      await download({
        certId: 'SB-2026-VALEDABCEFGH-AA',
        recipientName: 'A Student',
        pathTitle: 'Web Development Basics',
        issuedAt: '2026-11-11T00:00:00.000Z',
        score: 90,
        hours: 12
      });
    }, action);
    const download = await downloadPromise;
    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    expect((await stat(filePath)).size).toBeGreaterThan(0);
  }
});

test('guests complete required steps and receive fail/pass quiz feedback', async ({ page }) => {
  let submissions = 0;
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (!requestUrl.pathname.startsWith('/api/paths/')) {
      await route.continue();
      return;
    }
    if (requestUrl.pathname.endsWith('/quiz/start')) {
      const questions = Array.from({ length: 10 }, (_, index) => ({
        id: `question-${index + 1}`,
        prompt: `Question ${index + 1}`,
        options: [
          { id: `option-${index + 1}-a`, text: 'Option A' },
          { id: `option-${index + 1}-b`, text: 'Option B' }
        ]
      }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attemptId: '00000000-0000-4000-8000-000000000001',
          expiresAt: Date.now() + 60_000,
          questions,
          passMark: 70
        })
      });
      return;
    }
    if (requestUrl.pathname.endsWith('/quiz/submit')) {
      submissions += 1;
      const passed = submissions === 2;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          score: passed ? 80 : 60,
          passed,
          passMark: 70,
          results: Array.from({ length: 10 }, (_, index) => ({
            isCorrect: passed ? index < 8 : index < 6,
            correctAnswer: 'Option A',
            explanation: `Explanation ${index + 1}`,
            topicTags: ['Foundations']
          }))
        })
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/#my-learning');
  const firstPath = page.locator('#my-learning-paths .learning-path-card').first();
  await firstPath.locator('[data-path-watch="prep-113"]').click();
  for (const courseId of ['crs-01', 'crs-02']) {
    await firstPath.locator(`[data-course-declare="web-development-basics"][data-course-id="${courseId}"]`).click();
    await page.locator('#course-declaration-form button[type="submit"]').click();
  }
  await expect(firstPath.locator('[data-path-quiz="web-development-basics"]')).toBeEnabled();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await firstPath.locator('[data-path-quiz="web-development-basics"]').click();
    const quiz = page.locator('#path-quiz-form');
    await expect(quiz.locator('fieldset')).toHaveCount(10);
    await expect(quiz.locator('.quiz-explanation')).toHaveCount(0);
    for (let index = 0; index < 10; index += 1) {
      await quiz.locator('fieldset').nth(index).locator('input[type="radio"]').first().check();
    }
    await quiz.locator('button[type="submit"]').click();
    await expect(page.locator('#global-modal-overlay')).toContainText(attempt === 1 ? 'Keep practicing' : 'Quiz passed');
    await expect(page.locator('#global-modal-overlay')).toContainText('Explanation 1');
    if (attempt === 1) {
      await page.locator('#global-modal-overlay [data-close-modal]').click();
    }
  }
  await expect(page.locator('#global-modal-overlay')).toContainText('Sign in to transfer this server-graded quiz result');
  expect(submissions).toBe(2);
});
