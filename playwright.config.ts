import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.TR_CLONES_E2E_PORT ?? 4323);
// The page under test is one machine: the one MACHINE named when it was
// built, the 808 when it named none. A machine's tests are in its folder.
const machine = process.env.MACHINE ?? '808';
const own = new RegExp(`/${machine}/.*\\.spec\\.ts`);
const ownPhone = new RegExp(`/${machine}/phone\\.spec\\.ts`);

// The tests run against the production build of the host page, served as
// plain files with no server behind it. Run `pnpm build` first.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'off',
  },
  projects: [
    { name: machine, use: { ...devices['Desktop Chrome'] }, testMatch: own, testIgnore: ownPhone },
    { name: `${machine}-phone`, use: { ...devices['Pixel 7'] }, testMatch: ownPhone },
  ],
  webServer: {
    command: `pnpm --filter @tr-clones/host exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/boombapbot-assets.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
