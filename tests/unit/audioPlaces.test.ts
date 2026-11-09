import { describe, expect, it } from 'vitest';
import { environmentMix } from '../../client/src/audio/audioModel';

const open = { indoor: 0, shelter: 0, exposure: 0, chatter: 0 };

describe('the sound of a place', () => {
  it('muffles the outdoors inside the lodge and brings up the room and its conversation', () => {
    const out = environmentMix(open, 10), inside = environmentMix({ ...open, indoor: 1, chatter: 1 }, 10);
    expect(inside.wind).toBeLessThan(out.wind * 0.1);
    expect(inside.breeze).toBeLessThan(out.breeze * 0.1);
    expect(inside.cutoff).toBeLessThan(0.25);
    expect(inside.room).toBeGreaterThan(0.04);
    expect(inside.babble).toBeGreaterThan(environmentMix({ ...open, chatter: 1 }, 10).babble * 4);
    expect(inside.distant).toBeLessThan(0.2);
    expect(inside.knockEvery).toBe(Infinity);
  });

  it('hushes the wind in a grove, where bare branches knock now and then', () => {
    const grove = environmentMix({ ...open, shelter: 0.9 }, 10), out = environmentMix(open, 10);
    expect(grove.wind).toBeLessThan(out.wind * 0.6);
    expect(grove.cutoff).toBeLessThan(out.cutoff);
    expect(grove.knockEvery).toBeLessThan(5);
    expect(grove.whistle).toBe(0);
  });

  it('makes an exposed ridge windier and brighter, with gusts and a whistle', () => {
    const ridge = Array.from({ length: 200 }, (_, i) => environmentMix({ ...open, exposure: 1 }, i * 0.5));
    const out = environmentMix(open, 10);
    expect(Math.min(...ridge.map((r) => r.breeze))).toBeGreaterThan(out.breeze * 2.5);
    expect(Math.max(...ridge.map((r) => r.wind)) / Math.min(...ridge.map((r) => r.wind))).toBeGreaterThan(1.3); // gusting
    expect(Math.max(...ridge.map((r) => r.whistle))).toBeGreaterThan(0.02);
    expect(ridge[0].cutoff).toBeGreaterThan(out.cutoff);
  });
});
