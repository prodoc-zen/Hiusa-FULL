import base from '/home/user/Hiusa-FULL/client/playwright.config.js';

export default {
  ...base,
  testDir: '/home/user/Hiusa-FULL/client/e2e',
  reporter: 'line',
  outputDir: '<scratchpad>/pw-results',
  use: {
    ...base.use,
    trace: 'off',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  webServer: { ...base.webServer, cwd: '/home/user/Hiusa-FULL/client', reuseExistingServer: true },
};
