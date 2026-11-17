import { test, expect } from '@playwright/test';

for (const fallback of [false, true])
  test(`a guest keeps their outfit from the queue through both chair detail levels and onto the slope (${fallback ? 'WebGL2' : 'default renderer'})`, async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'webkit' && fallback,
      'The default WebKit case already covers this browser.',
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || /exceeds the maximum|validation error/i.test(m.text())) errors.push(m.text());
    });
    await page.goto(`/?autostart=1&quality=${fallback ? 'low' : 'high'}&mute=1${fallback ? '&webgl=1' : ''}`);
    await page.waitForFunction(
      () => (window as any).game?.baseLife?.people.some((p: any) => p.queue && p.guest?.look.hat === 'beanie'),
      null,
      { timeout: 120000 },
    );
    const result = await page.evaluate(() => {
      const game = (window as any).game;
      const person = game.baseLife.people.find((p: any) => p.queue && p.guest?.look.hat === 'beanie');
      const lift = game.lifts,
        li = person.queue.q.li,
        path = lift.paths[li],
        riders = lift.riders[li];
      lift.beginFrame();
      try {
        const now = lift.now(li),
          pos = game.camera.position.clone();
        const slot = riders.slots.find((s: any) => {
          const seat = lift.seatTransform(li, s.chair, s.seat, now, pos);
          return (
            seat.uphill &&
            seat.h > 35 &&
            seat.h < path.horiz - 35 &&
            !lift.reservedTrips.has(`${li}/${s.chair}`)
          );
        });
        lift.assignRider(li, slot.chair, slot.seat, person.guest);
        const sample = (distance: number) => {
          const viewer = pos.clone();
          viewer.x += distance;
          lift.update([], viewer);
          for (const mesh of riders.batches.meshes) {
            const matrix = game.camera.matrix.clone();
            for (let i = 0; i < mesh.count; i++) {
              mesh.getMatrixAt(i, matrix);
              if (pos.distanceTo(viewer.clone().setFromMatrixPosition(matrix)) > 0.02) continue;
              const tint = mesh.geometry.getAttribute('riderColor');
              return {
                name: mesh.name,
                jacket: [tint.getX(i), tint.getY(i), tint.getZ(i)],
                tris: mesh.geometry.index.count / 3,
                build: viewer.clone().setFromMatrixScale(matrix).toArray(),
              };
            }
          }
          throw new Error('The assigned passenger is missing from the rendered seat');
        };
        const near = sample(6),
          far = sample(100);
        const skier = game.ambient.fromLiftTop(li, slot.chair, slot.seat);
        return {
          near,
          far,
          sourceColor: person.model.look.jacket.toArray(),
          queueBuild: person.model.root.scale.toArray(),
          skierBuild: skier.model.root.scale.toArray(),
          sameGuest: skier.guest.id === person.guest.id,
          slopeHat: skier.model.root.getObjectByName('rib-knit-beanie')?.name,
          backend: game.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
        };
      } finally {
        lift.endFrame();
      }
    });
    expect(result.sameGuest).toBe(true);
    expect(result.slopeHat).toBe('rib-knit-beanie');
    expect(result.near.name).toBe('chair-riders-beanie-near');
    expect(result.far.name).toBe('chair-riders-beanie-far');
    expect(result.far.tris).toBeLessThan(result.near.tris / 4);
    for (let k = 0; k < 3; k++) {
      expect(result.near.jacket[k]).toBeCloseTo(result.sourceColor[k], 5);
      expect(result.far.jacket[k]).toBeCloseTo(result.sourceColor[k], 5);
      expect(result.near.build[k]).toBeCloseTo(result.queueBuild[k], 5);
      expect(result.skierBuild[k]).toBeCloseTo(result.queueBuild[k], 5);
    }
    if (fallback) expect(result.backend).toBe('WebGL2');
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });
