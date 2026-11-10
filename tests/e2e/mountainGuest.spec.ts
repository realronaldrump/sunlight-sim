import { expect, test, type Page } from '@playwright/test';
import { loadGuestWorld } from '../../client/src/world/mountainGuestWorld';
import { MountainGuest } from '../../shared/mountainGuest';
import { createSkier } from '../../shared/skiPhysics';
import { fsLoader } from '../harness/world';

const params = 'autostart=1&quality=low&ambient=0&mute=1&weather=clear&snowmemory=0';
const savedKey = 'sunlight.mountain-guest.v1';

async function ready(page: Page) {
  await page.waitForFunction(() => {
    const g = (window as any).game;
    return g?.ready && g.mountainGuest.pose;
  }, null, { timeout: 150_000 });
}

test('the optional map marker and an in-world sighting are saved independently', async ({ page }, info) => {
  const resort = JSON.parse(new TextDecoder().decode(await fsLoader('/world/resort.json')));
  const { navigation, colliders } = await loadGuestWorld('/world', resort, fsLoader);
  const saved = new MountainGuest(navigation, colliders, 187).checkpoint();
  const spot = { x: 79, z: -997 };
  saved.st = createSkier({ ...spot, y: navigation.probe.height(spot.x, spot.z) }, -Math.PI / 2);
  saved.route = []; saved.cursor = 0; saved.rest = 100;
  await page.addInitScript(({ saved, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved)); }, { saved, key: savedKey });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?' + params);
  await ready(page);
  const mapSwitch = page.getByRole('checkbox', { name: 'Show Trump Santa on map' });
  const mapKey = page.locator('#tmap .santa-key');
  const openMap = () => page.getByRole('button', { name: 'Open full trail map (M)' }).click();
  const closeMap = () => page.locator('#tmap .close').first().click();
  const options = page.getByRole('dialog', { name: 'Pause menu' });
  const resume = () => options.getByRole('button', { name: 'Resume' }).click();
  await openMap();
  await expect(page.locator('#tmap')).toBeVisible();
  await expect(mapKey).toBeHidden();
  await closeMap();
  await page.keyboard.press('Escape');
  await expect(options).toBeVisible();
  await expect(page.locator('#santa-sighting')).toBeHidden();
  await expect(mapSwitch).not.toBeChecked();
  await mapSwitch.check();
  await resume();
  await openMap();
  await expect(mapKey).toBeVisible();
  expect(await page.evaluate(() => {
    const g = (window as any).game, p = g.mountainGuest.pose;
    const [x, y] = g.trailMap.toScreen(p.x, p.z);
    return g.trailMap.santa === p && g.trailMap.pickPlayer(x, y) === null;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('santa-trail-map.png') });
  await closeMap();
  const hasBadgePixels = (selector: string) => page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === 133 && pixels[i + 1] === 29 && pixels[i + 2] === 54) return true;
    }
    return false;
  });
  await expect.poll(() => hasBadgePixels('#minimap canvas')).toBe(true);
  await page.locator('#minimap').screenshot({ path: info.outputPath('santa-minimap.png') });
  expect(await page.evaluate(() => (window as any).game.mountainGuest.discovery.foundAt)).toBeNull();
  const look = (facing: number) => page.evaluate(async ({ spot, facing }) => {
    const g = (window as any).game;
    await g.hf.ensureArea(0, spot.x, -spot.z, 100);
    g.player.teleport(spot.x + 8, spot.z, facing);
    g.camRig.mode = 'first'; g.camRig.reset();
  }, { spot, facing });
  await look(-Math.PI / 2);
  await page.waitForFunction(() => (window as any).game.mountainGuest.group.getObjectByName('mountain-guest')?.visible);
  await page.waitForTimeout(1000);
  await expect(page.locator('#toast')).not.toContainText('Santa Sighting');
  await look(Math.PI / 2);
  await expect(page.locator('#toast')).toContainText('Achievement unlocked · Santa Sighting', { timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#santa-sighting')).toBeVisible();
  await expect(page.locator('#santa-sighting')).toContainText('Discovered');
  await page.screenshot({ path: info.outputPath('santa-sighting.png') });
  const unlocked = await page.evaluate(() => (window as any).game.mountainGuest.discovery.foundAt);
  await page.reload();
  await ready(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#santa-sighting')).toBeVisible();
  await expect(mapSwitch).toBeChecked();
  await mapSwitch.uncheck();
  await resume();
  await expect.poll(() => hasBadgePixels('#minimap canvas')).toBe(false);
  await openMap();
  await expect(mapKey).toBeHidden();
  expect(await page.evaluate(() => (window as any).game.mountainGuest.discovery.foundAt)).toBe(unlocked);
  expect(errors).toEqual([]);
});

test('two friends and a reconnect see the same resident, even when they start far away', async ({ browser, page }) => {
  const errors: string[] = [];
  const second = await browser.newPage();
  for (const p of [page, second]) p.on('pageerror', e => errors.push(e.message));
  const server = process.env.E2E_GUEST_SERVER;
  const url = '/?' + params + '&room=S' + Math.random().toString(36).slice(2, 7) + (server ? '&server=' + encodeURIComponent(server) : '');
  const sample = (p: Page) => p.evaluate(() => {
    const g = (window as any).game;
    return { pose: g.mountainGuest.pose, remote: g.mountainGuest.remote, players: g.net.remotes.size, id: g.net.id };
  });
  try {
    await page.goto(url + '&name=First');
    await ready(page);
    const early = await sample(page);
    expect(early.remote).toBe(true);
    await second.goto(new URL(url + '&name=Friend', page.url()).href);
    await ready(second);
    await expect.poll(async () => (await sample(second)).players).toBe(1);
    const checkPair = async () => {
      // The socket can reconnect before the first new render. Compare the
      // views after both browsers have had a chance to apply fresh snapshots.
      await expect.poll(async () => {
        const [a, b] = await Promise.all([sample(page), sample(second)]);
        if (!a.remote || !b.remote) return Infinity;
        return Math.hypot(a.pose.x - b.pose.x, a.pose.y - b.pose.y, a.pose.z - b.pose.z);
      }, { timeout: 8000 }).toBeLessThan(4);
    };
    await checkPair();
    for (const p of [page, second]) await p.evaluate(async () => {
      const g = (window as any).game, p = g.mountainGuest.pose;
      await g.setView(p.x + 12, p.y + 3, p.z, 90, -10);
    });
    for (const p of [page, second]) {
      await p.waitForFunction(() => (window as any).game.mountainGuest.group.getObjectByName('mountain-guest')?.visible);
      expect(await p.evaluate(() => {
        const g = (window as any).game;
        return g.mountainGuest.group.children.filter((child: any) => child.name === 'mountain-guest').length;
      })).toBe(1);
    }
    const oldId = (await sample(second)).id;
    await second.evaluate(() => (window as any).game.net.ws.close());
    await second.waitForFunction(id => {
      const g = (window as any).game;
      return g.net.connected && g.net.id !== id;
    }, oldId, { timeout: 25_000 });
    await checkPair();
    expect(errors).toEqual([]);
  } finally { await second.close(); }
});
