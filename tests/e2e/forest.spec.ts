import { test, expect } from '@playwright/test';

// Real terrain and seeded trees at both supported renderer backends and quality extremes.
// Keep these captures reviewable instead of comparing changing weather to golden pixels.
for (const quality of ['high', 'low']) for (const webgl of [false, true]) {
  test(`winter forest ${quality} ${webgl ? 'WebGL2' : 'WebGPU'}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/?autostart=1&ambient=0&mute=1&quality=${quality}${webgl ? '&webgl=1' : ''}`);
    await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120000 });
    await page.waitForFunction(() => {
      const t = (window as any).game.trees; return t.loaded === t.total;
    });
    const prefix = `screenshots/forest-review/${quality}-${webgl ? 'webgl' : 'webgpu'}`;
    const tree = await page.evaluate(async () => {
      const g = (window as any).game;
      document.getElementById('help')?.classList.add('hidden');
      const r = g.resort.runs.find((r: any) => r.name === 'Ute' && r.kind === 'line');
      const p = r.points[Math.floor(r.points.length * .75)];
      let best = Infinity, found: any;
      for (const t of g.trees.tiles.values()) for (let i = 0; i < t.n; i++) {
        const d = Math.hypot(t.x[i] - p[0], t.z[i] - p[2]);
        if (t.s[i] === 2 && t.h[i] > 9 && !t.excluded[i] && d < best) {
          best = d; found = { x: t.x[i], y: t.y[i], z: t.z[i], h: t.h[i] };
        }
      }
      await g.hf.ensureArea(0, found.x, -found.z, 400);
      return found;
    });
    for (const distance of [14, 80, 100, quality === 'high' ? 205 : 105, quality === 'high' ? 245 : 145]) {
      const counts = await page.evaluate(async ({ tree, distance }) => {
        const g = (window as any).game;
        await g.lookAt(tree.x + distance * .8, tree.z + distance * .6, tree.x, tree.y + tree.h * .55, tree.z, distance === 14 ? 2 : 10);
        await g.waitIdle(30000);
        const near = new Set<string>();
        for (const tier of g.trees.nearMeshes) for (const mesh of tier) {
          const a = mesh.instanceMatrix.array;
          for (let i = 0; i < mesh.count; i++) near.add(`${a[i * 16 + 12]}:${a[i * 16 + 14]}`);
        }
        let missing = 0;
        for (const t of g.trees.tiles.values()) for (let i = 0; i < t.n; i++) {
          if (t.excluded[i]) continue;
          const a = t.mesh.instanceMatrix.array, o = i * 16;
          const farVisible = Math.hypot(a[o], a[o + 1], a[o + 2]) > 0;
          if (!farVisible && !near.has(`${t.x[i]}:${t.z[i]}`)) missing++;
        }
        return { near: g.trees.nearMeshes.map((tier: any[]) => tier.reduce((n, mesh) => n + mesh.count, 0)),
          missing, far: g.trees.tiles.size, drawn: g.renderer.info.render.drawCalls, webgl: !!g.renderer.backend.isWebGLBackend };
      }, { tree, distance });
      expect(counts.near[0]).toBeGreaterThan(0);
      expect(counts.far).toBeGreaterThan(50);
      expect(counts.drawn).toBeGreaterThan(100);
      expect(counts.webgl).toBe(webgl);
      expect(counts.missing).toBe(0);
      await page.screenshot({ path: `${prefix}-${distance}m.png` });
    }
    await page.evaluate(async () => {
      const g = (window as any).game, l = g.resort.lifts.find((l: any) => l.name === 'Segundo');
      const b = l.bottom, t = l.top;
      await g.lookAt(b[0] + 300, b[2] - 500, (b[0] + t[0]) / 2, (b[1] + t[1]) / 2, (b[2] + t[2]) / 2, 140);
      await g.waitIdle(30000);
    });
    await page.screenshot({ path: `${prefix}-distant.png` });
    expect(errors).toEqual([]);
  });
}
