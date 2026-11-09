import { defineConfig, devices } from '@playwright/test';

const gpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: gpuArgs },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: gpuArgs } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } }, testMatch: /(smoke|minimap|audio)\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
