import { test, expect, devices, type Page } from '@playwright/test';

async function boot(page: Page, room?: string, name = 'Ann') {
  const server = encodeURIComponent(process.env.TEST_SERVER_URL ?? 'ws://localhost:8787');
  await page.goto(`/?autostart=1&quality=low&mute=1&ambient=0&snowmemory=0&webgl=1&name=${name}${room ? `&room=${room}&server=${server}` : ''}`);
  await page.waitForFunction(room => (window as any).game?.ready && (!room || (window as any).game.net?.connected), room, { timeout: 120000 });
}
async function pin(page: Page, point = { x: 18.3, z: 956.3 }) {
  await page.evaluate(() => (window as any).game.trailMap.toggle(true));
  const xy = await page.evaluate(p => (window as any).game.trailMap.toScreen(p.x, p.z), point);
  await page.locator('#tmap canvas').click({ position: { x: xy[0], y: xy[1] } });
  await expect.poll(() => page.evaluate(() => {
    const n = (window as any).game.navigation; return !n.planning && !!n.route;
  }), { timeout: 60000 }).toBe(true);
}

test('pin plans connected lifts, preserves map gestures, guides on snow and replans after riding', async ({ page, browserName }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  const before = await page.evaluate(() => ({ ...(window as any).game.player.st.pos }));
  await pin(page);
  const route = await page.evaluate(() => (window as any).game.navigation.route);
  expect(route.legs.filter((l: any) => l.mode === 'lift').map((l: any) => l.name)).toEqual(['Tercero', 'Primo']);
  expect(route.walking).toBe(0);
  expect(await page.evaluate(p => Math.hypot((window as any).game.player.st.pos.x - p.x, (window as any).game.player.st.pos.z - p.z), before)).toBeLessThan(3);
  await expect(page.locator('.route-summary')).toContainText('Stay on skis');
  await expect(page.getByRole('list', { name: 'Route steps' })).toContainText('Ride Primo');
  await page.screenshot({ path: `screenshots/navigation/map-${browserName}.png` });
  const original = await page.evaluate(() => (window as any).game.navigation.destination);
  await page.getByRole('button', { name: 'North up', exact: true }).click();
  await page.mouse.move(900, 450); await page.mouse.down(); await page.mouse.move(950, 490, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => (window as any).game.navigation.destination)).toEqual(original);
  await page.keyboard.press('KeyM');
  await expect(page.getByRole('region', { name: 'Route guidance' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).game.navigation.group.children[0].geometry.drawRange.count)).toBeGreaterThan(0);
  await page.screenshot({ path: `screenshots/navigation/snow-${browserName}.png` });

  // Actual chair contact, followed by the existing skip action; route must adapt at both transitions.
  await page.evaluate(() => {
    const g = (window as any).game, p = g.lifts.paths.find((p: any) => p.def.name === 'Tercero'), at = p.loadPoint();
    g.player.teleport(at.x, at.z, at.heading);
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 30000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const n = (window as any).game.navigation; return !n.planning && n.route?.legs[0]?.mode;
  }), { timeout: 30000 }).toBe('lift');
  await expect(page.locator('#route-guide strong')).toHaveText('Ride Tercero');
  await page.evaluate(() => (window as any).game.player.skipRide());
  await expect.poll(() => page.evaluate(() => {
    const n = (window as any).game.navigation; return !n.planning && n.route?.legs.filter((l: any) => l.mode === 'lift').map((l: any) => l.name);
  }), { timeout: 30000 }).toEqual(['Primo']);

  await page.evaluate(async () => {
    const g = (window as any).game, p = g.navigation.destination;
    await g.hf.ensureArea(0, p.x, -p.z, 50); g.player.teleport(p.x, p.z, 0);
  });
  await expect(page.locator('#route-guide strong')).toHaveText('You reached your pin', { timeout: 30000 });
  await page.locator('#route-guide').getByRole('button', { name: 'Clear pin' }).click();
  await expect(page.locator('#route-guide')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).game.navigation.group.children[0].geometry.drawRange.count)).toBe(0);
  expect(errors).toEqual([]);
});

test('friends see routes on arrival, route to the same pin, reconnect and clear independently', async ({ browser, browserName }) => {
  const room = 'N' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const aContext = await browser.newContext(), bContext = await browser.newContext();
  const a = await aContext.newPage(), b = await bContext.newPage();
  const errors: string[] = []; for (const page of [a, b]) page.on('pageerror', e => errors.push(e.message));
  try {
    await boot(a, room); await pin(a);
    await boot(b, room, 'Ben');
    await expect.poll(() => b.evaluate(() => (window as any).game.net.routes.size), { timeout: 20000 }).toBe(1);
    const expected = await a.evaluate(() => (window as any).game.navigation.shared);
    expect(await b.evaluate(() => [...(window as any).game.net.routes.values()][0])).toEqual(expected);
    await b.evaluate(() => (window as any).game.trailMap.toggle(true));
    await expect(b.getByRole('button', { name: 'Route to Ann’s pin' })).toBeVisible();
    await b.screenshot({ path: `screenshots/navigation/friends-${browserName}.png` });
    await b.getByRole('button', { name: 'Route to Ann’s pin' }).click();
    await expect.poll(() => b.evaluate(() => !(window as any).game.navigation.planning && !!(window as any).game.navigation.route), { timeout: 60000 }).toBe(true);
    await expect.poll(() => a.evaluate(() => (window as any).game.net.routes.size), { timeout: 10000 }).toBe(1);
    const oldId = await a.evaluate(() => { const n = (window as any).game.net, id = n.id; n.ws.close(); return id; });
    await expect.poll(() => a.evaluate(() => (window as any).game.net.id), { timeout: 20000 }).not.toBe(oldId);
    await expect.poll(() => b.evaluate(() => (window as any).game.net.routes.size), { timeout: 20000 }).toBe(1);
    expect(await b.evaluate(() => [...(window as any).game.net.routes.values()][0])).toEqual(expected);
    await a.locator('.route-panel').getByRole('button', { name: 'Clear pin', exact: true }).click();
    await expect.poll(() => b.evaluate(() => (window as any).game.net.routes.size)).toBe(0);
    expect(await b.evaluate(() => !!(window as any).game.navigation.route)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await aContext.close(); await bContext.close(); }
});

test('invalid destinations report no route without a direct line through obstacles', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const g = (window as any).game; g.trailMap.toggle(true); g.navigation.setPin({ x: 112.5, z: -960.5 });
  });
  await expect(page.locator('.route-summary')).toContainText('No passable route', { timeout: 60000 });
  expect(await page.evaluate(() => (window as any).game.navigation.route)).toBeNull();
  await page.evaluate(() => (window as any).game.navigation.setPin({ x: 5000, z: 5000 }));
  await expect(page.locator('.route-summary')).toContainText('inside the ski area');
});

test('phone map taps place a shared-ready pin while drag and pinch keep the destination', async ({ browser, browserName }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent });
  const page = await context.newPage();
  try {
    await boot(page);
    await page.evaluate(() => (window as any).game.trailMap.toggle(true));
    const p = await page.evaluate(() => (window as any).game.trailMap.toScreen(18.3, 956.3));
    await page.touchscreen.tap(p[0], p[1]);
    await expect.poll(() => page.evaluate(() => !(window as any).game.navigation.planning && !!(window as any).game.navigation.route), { timeout: 60000 }).toBe(true);
    const destination = await page.evaluate(() => (window as any).game.navigation.destination);
    const map = page.locator('#tmap canvas');
    await map.dispatchEvent('pointerdown', { pointerId: 20, pointerType: 'touch', button: 0, clientX: 170, clientY: 340 });
    await map.dispatchEvent('pointerdown', { pointerId: 21, pointerType: 'touch', button: 0, clientX: 220, clientY: 380 });
    await map.dispatchEvent('pointermove', { pointerId: 21, pointerType: 'touch', clientX: 260, clientY: 420 });
    await map.dispatchEvent('pointerup', { pointerId: 20, pointerType: 'touch' });
    await map.dispatchEvent('pointerup', { pointerId: 21, pointerType: 'touch' });
    expect(await page.evaluate(() => (window as any).game.navigation.destination)).toEqual(destination);
    expect(await page.locator('.route-panel').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: `screenshots/navigation/phone-${browserName}.png` });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await page.evaluate(() => (window as any).game.drone.active)).toBe(true);
    await expect(page.locator('#route-guide')).toBeVisible();
  } finally { await context.close(); }
});
