import { expect, test } from '@playwright/test';

test('the lodge walker carries his sign while crossing the ski rack apron', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /THREE|WebGPU|WebGL/.test(message.text())) errors.push(message.text());
  });
  await page.goto('/?quality=low&mute=1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Ski solo', exact: true }).click({ timeout: 120_000 });
  await page.waitForFunction(() => {
    const game = (window as any).game;
    const walker = game?.scene.getObjectByName('lodge-sign-walker');
    const print = walker?.getObjectByName('rob-ittner-sign')?.children[0].material[5].map;
    return game?.ready && walker?.visible && print?.image?.complete && print.image.naturalWidth === 600;
  }, null, { timeout: 60_000 });

  const sample = () => page.evaluate(() => {
    const game = (window as any).game;
    const walker = game.scene.getObjectByName('lodge-sign-walker');
    const { x, y, z } = walker.position;
    const board = walker.getObjectByName('rob-ittner-sign');
    const wrist = walker.getObjectByName('hand_r');
    const boot = walker.getObjectByName('walking-boot');
    return {
      x, z, bootZ: boot.position.z,
      baseDistance: Math.hypot(x - game.player.position.x, z - game.player.position.z),
      heightError: Math.abs(y - game.player.terrainHeight(x, z)),
      wristDistance: board.position.distanceTo(wrist.position),
    };
  });
  const start = await sample();
  expect(start.baseDistance).toBeLessThan(18);
  expect(start.heightError).toBeLessThan(0.06);
  expect(start.wristDistance).toBeLessThan(0.14);

  await expect.poll(async () => {
    const now = await sample();
    return Math.hypot(now.x - start.x, now.z - start.z) > 3 && Math.abs(now.bootZ - start.bootZ) > 0.08;
  }, { timeout: 25_000 }).toBe(true);
  const walking = await sample();
  expect(walking.baseDistance).toBeLessThan(18);
  expect(walking.heightError).toBeLessThan(0.06);
  expect(walking.wristDistance).toBeCloseTo(start.wristDistance, 4);
  expect(errors).toEqual([]);
});
