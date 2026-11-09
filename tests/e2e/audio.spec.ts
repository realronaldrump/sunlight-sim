// Render the actual game audio graph, not mocks. Works against Vite or a frozen production preview.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AudioState } from '../../client/src/audio/audioModel';

test('recorded soundscape renders, pans, changes surface, and truly mutes', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?autostart=1&mute=1&ambient=0');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  const result = await page.evaluate(async () => {
    const Audio = (window as any).game.audio.constructor;
    const base = { speed: 0, skid: 0, edge: 0, grounded: true, groomed: 1, moguls: 0,
      plow: 0, riding: false, nearTerminal: 1000, towerPass: false, fell: false, inAir: false };
    const cases: Record<string, Partial<AudioState>> = {
      resting: {}, glide: { speed: 12 }, carve: { speed: 12, edge: .8 },
      brake: { speed: 12, plow: 1, skid: .9 }, powder: { speed: 12, groomed: 0, edge: .6 },
      airborne: { speed: 12, inAir: true },
      liftLeft: { riding: true, terminals: [{ id: 'test', distance: 5, pan: -.9, speed: 2.3, variant: 0 }] },
      liftRight: { riding: true, terminals: [{ id: 'test', distance: 5, pan: .9, speed: 2.3, variant: 0 }] },
      liftFar: { riding: true, terminals: [{ id: 'test', distance: 100, pan: .9, speed: 2.3, variant: 0 }] },
      tower: { riding: true }, skip: { riding: true },
      passerLeft: { skiers: [{ active: true, distance: 2, pan: -.9, speed: 14, skid: .8, groomed: 1 }] },
      passerAir: { skiers: [{ active: false, distance: 2, pan: -.9, speed: 14, skid: .8, groomed: 1 }] },
      impacts: { speed: 12, skid: .8, plow: .6, nearTerminal: 3 },
      mute: { riding: true, nearTerminal: 4 }, zeroVolume: { speed: 16, skid: 1, nearTerminal: 4 },
    };
    const stats: Record<string, { rms: number; left: number; right: number; peak: number; brightness: number; tail: number; voices: number }> = {};
    const clips: { name: string; pcm: string }[] = [];
    for (const [name, change] of Object.entries(cases)) {
      const rate = 24000, seconds = 6;
      const ctx = new OfflineAudioContext(2, rate*seconds, rate);
      const a = new Audio(); a.start(ctx); await a.assetsReady;
      if (a.failedSamples.size || a.loadedSamples.size !== 14) throw new Error(`Missing audio assets: ${JSON.stringify([...a.sampleErrors])}`);
      for (let i = 0; i < seconds*60; i++) {
        const at = i/60;
        if (name === 'mute' && at >= 3) a.enabled = false;
        if (name === 'zeroVolume' && at >= 3) a.volume = 0;
        a.update(1/60, { ...base, ...change,
          riding: name === 'skip' ? at < 3 : !!change.riding,
          discontinuity: name === 'skip' && i === 180,
          towerPass: ['mute', 'tower', 'skip'].includes(name) && i === 170,
          fell: name === 'impacts' && i === 180,
          impact: 12, landing: name === 'impacts' && i === 260 ? 4 : 0,
        }, at);
      }
      const buffer = await ctx.startRendering(), l = buffer.getChannelData(0), r = buffer.getChannelData(1);
      let l2 = 0, r2 = 0, peak = 0, high = 0, tail = 0;
      for (let i = rate*2; i < l.length; i++) {
        l2 += l[i]*l[i]; r2 += r[i]*r[i]; peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
        high += (l[i]-l[i-1])**2+(r[i]-r[i-1])**2;
        if (i > rate*4) tail += l[i]*l[i]+r[i]*r[i];
      }
      const count = l.length-rate*2;
      stats[name] = { rms: Math.sqrt((l2+r2)/(2*count)), left: Math.sqrt(l2/count), right: Math.sqrt(r2/count),
        peak, brightness: high/Math.max(1e-12,l2+r2), tail: Math.sqrt(tail/(rate*4)), voices: a.activeVoices };
      // Keep render evidence in test output; each segment has one second of silence removed.
      const pcm = new Uint8Array((l.length-rate)*4), view = new DataView(pcm.buffer);
      for (let i = rate; i < l.length; i++) {
        view.setInt16((i-rate)*4, Math.round(Math.max(-1, Math.min(1,l[i]))*32767), true);
        view.setInt16((i-rate)*4+2, Math.round(Math.max(-1, Math.min(1,r[i]))*32767), true);
      }
      let binary = '';
      for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i,i+8192));
      clips.push({ name, pcm: btoa(binary) });
      a.dispose();
      if (a.activeVoices) throw new Error('Audio disposal left active event voices');
    }
    return { stats, clips };
  });
  const out = info.outputPath('audio'); mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/levels.json`, JSON.stringify(result.stats, null, 2));
  for (const clip of result.clips) {
    const pcm = Buffer.from(clip.pcm, 'base64'), header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(pcm.length+36,4); header.write('WAVEfmt ',8);
    header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(2,22);
    header.writeUInt32LE(24000,24); header.writeUInt32LE(96000,28); header.writeUInt16LE(4,32); header.writeUInt16LE(16,34);
    header.write('data',36); header.writeUInt32LE(pcm.length,40);
    writeFileSync(`${out}/${clip.name}.wav`, Buffer.concat([header,pcm]));
  }
  const s = result.stats;
  for (const x of Object.values(s)) {
    expect(x.peak).toBeLessThan(.95);
    expect(Number.isFinite(x.rms)).toBe(true);
    expect(x.voices).toBeLessThanOrEqual(24);
  }
  expect(s.glide.rms).toBeGreaterThan(s.resting.rms*2);
  expect(s.brake.rms).toBeGreaterThan(s.glide.rms*1.05);
  expect(s.carve.brightness).toBeGreaterThan(s.powder.brightness*1.3);
  expect(s.airborne.rms).toBeLessThan(s.glide.rms*.65);
  expect(s.liftLeft.left).toBeGreaterThan(s.liftLeft.right*2);
  expect(s.liftRight.right).toBeGreaterThan(s.liftRight.left*2);
  expect(s.liftFar.rms).toBeLessThan(s.liftRight.rms*.5);
  expect(s.tower.peak).toBeGreaterThan(s.resting.peak*2);
  expect(s.skip.tail).toBeCloseTo(s.resting.tail, 5);
  expect(s.passerLeft.left).toBeGreaterThan(s.passerLeft.right*2);
  expect(s.passerAir.rms).toBeCloseTo(s.resting.rms, 5);
  expect(s.mute.tail).toBeLessThan(1e-6);
  expect(s.zeroVolume.tail).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});

test('audio survives an unavailable recording and repeated mute gestures', async ({ page }) => {
  await page.route('**/audio/ski-glide.wav', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: 'invalid audio' }));
  await page.goto('/?autostart=1&ambient=0');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await page.keyboard.press('KeyH');
  await page.evaluate(() => (window as any).game.audio.assetsReady);
  const loaded = await page.evaluate(() => {
    const a = (window as any).game.audio;
    return { state: a.ctx.state, loaded: a.loadedSamples.size, failed: [...a.failedSamples] };
  });
  expect(loaded).toEqual({ state: 'running', loaded: 13, failed: ['ski-glide'] });
  await page.keyboard.press('KeyN');
  await expect.poll(() => page.evaluate(() => (window as any).game.audio.master.gain.value), { timeout: 2500 }).toBeLessThan(1e-5);
  await page.keyboard.press('KeyN');
  await expect.poll(() => page.evaluate(() => (window as any).game.audio.master.gain.value), { timeout: 2500 }).toBeGreaterThan(.7);
});
