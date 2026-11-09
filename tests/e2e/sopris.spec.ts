import { test, expect } from '@playwright/test';

for (const backend of ['webgpu', 'webgl2']) {
  test(`Sopris retains its measured summit and ridges on ${backend}`, async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && r.url().includes('/terrain/')) failed.push(r.url()); });
    await page.goto(`/?autostart=1&ambient=0&quality=high${backend === 'webgl2' ? '&webgl=1' : ''}`);
    await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
    await page.evaluate(() => {
      const g = (window as any).game;
      document.getElementById('help')?.classList.add('hidden');
      const t = g.resort.lifts.find((l: any) => l.name === 'Primo').top;
      g.lookAt(t[0] + 15, t[2] + 25, 14731, 3841, 14803, 2);
    });
    await expect.poll(() => page.evaluate(() => {
      const g = (window as any).game;
      // The actual mesh covering the summit must be 4 m, not just a loaded tile.
      const x = 14731, z = 14803;
      return g.terrain.group.children.filter((m: any) => {
        const size = 64 * 2 ** m.userData.level;
        return m.position.x <= x && m.position.x + size > x &&
          m.position.z >= z && m.position.z - size < z;
      }).map((m: any) => m.userData.level);
    }), { timeout: 60_000 }).toEqual([2]);
    expect(await page.evaluate(() => (window as any).game.waitIdle(60_000))).toBe(true);
    await page.screenshot({ path: `screenshots/sopris-${backend}-summit.png` });
    await page.evaluate(() => {
      const g = (window as any).game;
      g.camera.fov = 16;
      g.camera.updateProjectionMatrix();
      g.hf.evict(0, 0, 900);
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `screenshots/sopris-${backend}-detail.png` });
    const state = await page.evaluate(() => {
      const g = (window as any).game;
      return { cached: g.hf.bestLevel(14731, -14803), webgpu: !!g.renderer.backend.isWebGPUBackend };
    });
    expect(state.cached).toBe(2);
    expect(state.webgpu).toBe(backend === 'webgpu');
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });
}
