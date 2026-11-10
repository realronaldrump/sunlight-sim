import { expect, test, type Page } from '@playwright/test';
import { loadGuestWorld } from '../../client/src/world/mountainGuestWorld';
import { MountainGuest } from '../../shared/mountainGuest';
import { createSkier } from '../../shared/skiPhysics';
import { sightLine } from '../../client/src/world/santaDiscovery';
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
  saved.festivities = { searchAt: 1000, greetAt: 1000 };
  await page.addInitScript(({ saved, key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved)); }, { saved, key: savedKey });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?' + params);
  await ready(page);
  const mapSwitch = page.getByRole('checkbox', { name: 'Show Santa on map' });
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
  await expect(mapKey).toHaveText('● Santa');
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
  await expect(page.locator('#santa-gift-tag')).toHaveCount(0);
  await look(Math.PI / 2);
  await expect(page.locator('#santa-gift-tag')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#santa-gift-tag')).toContainText('Santa Sighting');
  await expect(page.getByText('to wave to Santa.')).toBeVisible();
  await page.keyboard.press('1');
  await page.waitForFunction(() => (window as any).game.mountainGuest.pose.action?.kind === 'hat-tip');
  await page.waitForTimeout(620);
  await page.locator('#santa-gift-tag').screenshot({ path: info.outputPath('santa-gift-tag.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#santa-sighting')).toBeVisible();
  await expect(page.locator('#santa-sighting')).toContainText('Discovered');
  await page.screenshot({ path: info.outputPath('santa-sighting.png') });
  const unlocked = await page.evaluate(() => (window as any).game.mountainGuest.discovery.foundAt);
  await page.reload();
  await ready(page);
  await expect(page.locator('#santa-gift-tag')).toHaveCount(0);
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

test('arriving later still reveals a decorated fir and ski tracks after Santa is gone', async ({ page }, info) => {
  const resort = JSON.parse(new TextDecoder().decode(await fsLoader('/world/resort.json')));
  const { navigation: nav, colliders } = await loadGuestWorld('/world', resort, fsLoader);
  const guest = new MountainGuest(nav, colliders, 1539);
  let fir;
  for (let i = 1; i <= 30 * 650; i++) {
    guest.advance(1 / 30, nav.lifts.map(() => 1_800_000_000 + i / 30));
    if (i % 30) continue;
    const p = guest.pose(), traces = guest.santaTraces();
    fir = traces.firs?.find(f => f.tree && guest.age - f.litAt > 160 &&
      Math.hypot(p.x - f.anchor.x, p.z - f.anchor.z) > 400 &&
      traces.tracks.some(([at, x, z, edge]) => guest.age - at > 75 && edge >= 0 && Math.hypot(x - f.anchor.x, z - f.anchor.z) < 35));
    if (fir) break;
  }
  expect(fir?.tree).toBeDefined();
  const tree = fir!.tree!, target = { x: tree.x, y: tree.y + tree.height * .43, z: tree.z };
  const view = Array.from({ length: 20 }, (_, i) => {
    const angle = i * Math.PI / 10;
    const x = tree.x + Math.cos(angle) * 20, z = tree.z + Math.sin(angle) * 20;
    return { x, y: nav.probe.height(x, z) + 1.72, z };
  }).find(p => nav.contains(p.x, p.z) && Math.abs(p.y - target.y) < 4 &&
    sightLine(p, { x: target.x, y: target.y, z: target.z }, nav.probe.height, colliders));
  const eye = view ?? { x: tree.x - 20, z: tree.z, y: nav.probe.height(tree.x - 20, tree.z) + 1.72 };
  await page.addInitScript(({ saved, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { saved: guest.checkpoint(), key: savedKey });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const look = async () => {
    await ready(page);
    await page.evaluate(async ({ eye, target }) => {
      const g = (window as any).game;
      await g.hf.ensureArea(0, eye.x, -eye.z, 150);
      await g.lookAt(eye.x, eye.z, target.x, target.y, target.z, 1.72);
    }, { eye, target });
    await page.waitForFunction(litAt => {
      const { mountainGuest: m } = (window as any).game;
      return m.traces.firs.some((f: any) => f.litAt === litAt) && m.decoratedFirs.get(litAt)?.group.visible &&
        m.group.getObjectByName('santa-fir-bulbs')?.count > 16 && m.group.getObjectByName('santa-ski-trail')?.visible &&
        !m.group.getObjectByName('mountain-guest')?.visible;
    }, fir!.litAt);
  };
  await page.goto('/?' + params);
  await look();
  await page.keyboard.press('H');
  await page.keyboard.press('V');
  await page.screenshot({ path: info.outputPath('santa-fir-afterward.png') });
  await page.reload();
  await look();
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

test('directional bells, fir chimes and the discovery chord reach the game audio graph', async ({ page }) => {
  await page.goto('/?' + params);
  await ready(page);
  const result = await page.evaluate(async () => {
    const g = (window as any).game;
    const Audio = g.audio.constructor;
    const listener = { x: 0, y: 2801.1, z: 0 }, forward = { x: 0, y: 0, z: -1 };
    const pose = { ...g.mountainGuest.pose, x: 5, y: 2800, z: 0, speed: 9, edge: .4, touring: 0, ride: null, airborne: false, fallen: 0 };
    const input = { speed: 0, skid: 0, edge: 0, grounded: true, groomed: 1, moguls: 0, plow: 0,
      riding: false, nearTerminal: 1000, towerPass: false, fell: false, inAir: false, altitude: 2800 };
    const out: Record<string, { voices: number; l: number; r: number }> = {};
    for (const kind of ['near', 'lead', 'far', 'chord', 'muted', 'release', 'approach']) {
      const ctx = new OfflineAudioContext(2, 24000, 24000), a = new Audio();
      a.enabled = kind !== 'muted';
      a.start(ctx);
      a.update(1 / 60, input, 0);
      const x = kind === 'near' ? 5 : kind === 'lead' ? 42 : 72;
      a.santaPass(1 / 60, { ...pose, x }, listener, forward);
      if (kind === 'chord' || kind === 'muted') a.santaDiscovery();
      if (kind === 'release' || kind === 'approach' || kind === 'muted') {
        const f = [{ litAt: 80, anchor: { x: kind === 'release' ? 28 : 7, y: 2801.3, z: 0 } }];
        const age = kind === 'release' ? 80.4 : 300;
        a.santaFirChimes(f, age, listener, forward);
        a.santaFirChimes(f, age + .1, listener, forward);
      }
      const voices = a.activeVoices;
      const render = await ctx.startRendering();
      const l = render.getChannelData(0), r = render.getChannelData(1);
      let lEnergy = 0, rEnergy = 0;
      for (let i = 2016; i < 15900; i++) {
        lEnergy += l[i] ** 2;
        rEnergy += r[i] ** 2;
      }
      out[kind] = { voices, l: lEnergy, r: rEnergy };
      a.dispose();
    }
    return out;
  });
  expect(result.near.voices).toBe(1);
  expect(result.lead.voices).toBe(2);
  expect(result.far.voices).toBe(0);
  expect(result.chord.voices).toBe(3);
  expect(result.muted.voices).toBe(0);
  expect(result.release.voices).toBe(1);
  expect(result.approach.voices).toBe(1);
  expect(result.near.r).toBeGreaterThan(result.near.l * 1.5);
  expect(result.near.r).toBeGreaterThan(result.far.r * 2);
  expect(result.lead.r).toBeGreaterThan(result.far.r);
  expect(result.release.r).toBeGreaterThan(result.far.r);
  expect(result.chord.r + result.chord.l).toBeGreaterThan((result.far.r + result.far.l) * 2);
  expect(result.muted.r + result.muted.l).toBeLessThan(.000001);
});
