import { expect, test } from '@playwright/test';

const useAuthEmulator = process.env.VITE_USE_AUTH_EMULATOR === 'true';
const authEmulator = useAuthEmulator
  ? (process.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'http://127.0.0.1:9099').replace(/\/$/, '')
  : '';
const apiKey = useAuthEmulator ? 'demo-api-key' : process.env.VITE_FIREBASE_API_KEY || '';

test.describe('Firebase Authentication emulator', () => {
  test.skip(!authEmulator, 'Set VITE_USE_AUTH_EMULATOR=true to run emulator auth tests.');

  async function openAuth(page) {
    await page.goto('/');
    await expect(page.locator('#auth-action-btn')).toBeEnabled();
    await page.locator('#auth-action-btn').click();
    await expect(page.locator('#auth-email')).toBeVisible();
  }

  async function createEmulatorUser(request, email, password = 'StrongPass123!') {
    const response = await request.post(
      `${authEmulator}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
      { data: { email, password, returnSecureToken: true } }
    );
    if (!response.ok()) throw new Error(await response.text());
    return response.json();
  }

  function uniqueEmail() {
    return `skillbridge-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  }

  async function signIn(page, email, password = 'StrongPass123!') {
    await openAuth(page);
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill(password);
    await page.locator('#auth-submit').click();
  }

  test('email sign-up sets display name and creates an authenticated profile', async ({ page }) => {
    await openAuth(page);
    await page.locator('#auth-mode-toggle').click();
    await page.locator('#auth-name').fill('Emulator Student');
    await page.locator('#auth-email').fill(uniqueEmail());
    await page.locator('#auth-password').fill('StrongPass123!');
    await page.locator('#auth-password-confirm').fill('StrongPass123!');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign out');
    await expect(page.locator('#header-profile-name')).toHaveText('Emulator');
  });

  test('email sign-in and wrong-password errors are shown clearly', async ({ page, request }) => {
    const email = uniqueEmail();
    await createEmulatorUser(request, email);
    await signIn(page, email);
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign out');

    await page.locator('#auth-action-btn').click();
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign in');
    await openAuth(page);
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill('WrongPass123!');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-error')).toContainText('email or password is incorrect');
  });

  test('weak password and confirmation mismatch are validated inline', async ({ page }) => {
    await openAuth(page);
    await page.locator('#auth-mode-toggle').click();
    await page.locator('#auth-name').fill('Emulator Student');
    await page.locator('#auth-email').fill(uniqueEmail());
    await page.locator('#auth-password').fill('short');
    await page.locator('#auth-password-confirm').fill('different');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-password-error')).toContainText('at least 8 characters');
    await expect(page.locator('#auth-password-confirm-error')).toContainText('do not match');
  });

  test('duplicate email is rejected with a useful message', async ({ page, request }) => {
    const email = uniqueEmail();
    await createEmulatorUser(request, email);
    await openAuth(page);
    await page.locator('#auth-mode-toggle').click();
    await page.locator('#auth-name').fill('Emulator Student');
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill('StrongPass123!');
    await page.locator('#auth-password-confirm').fill('StrongPass123!');
    await page.locator('#auth-submit').click();
    await expect(page.locator('#auth-error')).toContainText('already exists');
  });

  test('forgot password shows generic success without exposing account existence', async ({ page, request }) => {
    const email = uniqueEmail();
    await createEmulatorUser(request, email);
    await openAuth(page);
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-forgot-password').click();
    await expect(page.locator('#auth-error')).toContainText('If an account exists for that email');
  });

  test('logout clears authenticated state and a refresh restores an existing session', async ({ page, request }) => {
    const email = uniqueEmail();
    await createEmulatorUser(request, email);
    await signIn(page, email);
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign out');
    await page.reload();
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign out');
    await page.locator('#auth-action-btn').click();
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign in');
    await expect(page.locator('body')).toHaveAttribute('data-auth-state', 'guest');
  });

  test('continue as guest stays distinct from Firebase authentication', async ({ page }) => {
    await openAuth(page);
    await page.locator('#auth-guest').click();
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign in');
    await expect(page.locator('body')).toHaveAttribute('data-auth-state', 'guest');
    expect(await page.evaluate(() => localStorage.getItem('skillbridge_guest_mode'))).toBe('true');
    await page.goto('/#profile');
    await expect(page.locator('#profile-auth-notice')).toBeVisible();
  });

  test('Google sign-in completes through the Auth Emulator provider flow', async ({ page }) => {
    await openAuth(page);
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await page.locator('#auth-google').click({ noWaitAfter: true });
    const popup = await popupPromise;
    const providerPage = popup || page;
    await expect.poll(() => providerPage.url(), { timeout: 15000 })
      .toMatch(/127\.0\.0\.1:9099\/emulator\/auth\/handler/);
    await providerPage.getByRole('button', { name: 'Add new account' }).click({ noWaitAfter: true });
    await providerPage.locator('#autogen-button').click();
    await expect(providerPage.locator('#email-input')).not.toHaveValue('');
    await providerPage.locator('#sign-in').click({ noWaitAfter: true });
    await expect(page.locator('#auth-action-btn')).toHaveText('Sign out', { timeout: 20000 });
    await expect(page.locator('body')).toHaveAttribute('data-auth-state', 'authenticated');
    await expect.poll(() => page.evaluate(async () => {
      const { auth, db, firestoreApi } = await import('/client/src/services/firebase.js');
      if (!auth.currentUser) return false;
      const profile = await firestoreApi.getDoc(
        firestoreApi.doc(db, 'users', auth.currentUser.uid)
      );
      return profile.exists();
    }), { timeout: 15000 }).toBe(true);
  });

  test('password visibility toggle is accessible and reversible', async ({ page }) => {
    await openAuth(page);
    const password = page.locator('#auth-password');
    const toggle = page.locator('[data-toggle-password="auth-password"]');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  for (const width of [320, 1920]) {
    test(`auth modal fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openAuth(page);
      await expect(page.locator('#global-modal-dialog')).toBeVisible();
      expect(await page.locator('html').evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
});
