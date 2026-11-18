// The unload sign marks the snow table. The separate trip wand only sweeps the
// chair turnaround, below an empty bench and across the shins of a seated rider.
import * as THREE from 'three/webgpu';
import { SEAT_SPACING, type LiftPath } from '../../../shared/lifts';

interface Gate { pivot: THREE.Group; hit: number; at: THREE.Vector3; side: number }

export class MissedUnloadGates {
  readonly group = new THREE.Group();
  private gates: Gate[] = [];

  constructor(paths: LiftPath[], height: (x: number, z: number) => number) {
    this.group.name = 'missed-unload-gates';
    const metal = new THREE.MeshStandardNodeMaterial({ color: 0x525b5e, roughness: .55, metalness: .55 });
    const orange = new THREE.MeshStandardNodeMaterial({ color: 0xff621e, roughness: .55 });
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2f0, roughness: .6 });
    const unload = signMaterial('UNLOAD', 'HERE'), raise = signMaterial('RAISE', 'BAR');
    const prepare = signMaterial('PREPARE TO', 'UNLOAD');

    for (const path of paths) {
      const side = path.uphillSide, half = path.def.seats * SEAT_SPACING / 2;
      const marker = (h: number, material: THREE.Material, boardY: number, name: string) => {
        const rope = path.ropePoint(h, 1);
        const x = rope.x - side * path.rx * (half + .53), z = rope.z - side * path.rz * (half + .53);
        const ground = height(x, z);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(.038, .045, boardY - ground, 8), metal);
        mast.position.set(x, (ground + boardY) / 2, z);
        const board = new THREE.Mesh(new THREE.BoxGeometry(.59, .56, .035), [metal, metal, metal, metal, material, metal]);
        board.name = path.def.name + '-' + name;
        board.rotation.y = path.loadPoint().heading; // local +Z faces the arriving skier
        board.position.set(x, boardY, z);
        this.group.add(mast, board);
      };
      marker(path.unloadH, unload, path.stationHeight(true) + 1.16, 'unload-here');
      marker(path.raiseBarH, path.def.name === 'Tercero' ? prepare : raise,
        path.cableY(path.raiseBarH) - 2.05, 'approach-sign');

      const time = path.detectorU / path.def.speed;
      const rider = path.riderPoint(0, (path.def.seats - 1) / 2, time);
      const heading = rider.heading, rx = Math.cos(heading), rz = -Math.sin(heading);
      // Place the wand across the boots on this actual chair pose, including the outward bank.
      const at = new THREE.Vector3(rider.p.x - Math.sin(heading) * .2, rider.p.y + .04,
        rider.p.z - Math.cos(heading) * .2);
      const reach = half + .45;
      const x = at.x + rx * side * reach, z = at.z + rz * side * reach;
      const ground = height(x, z), postTop = at.y + .21;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, postTop - ground, 10), metal);
      post.position.set(x, (postTop + ground) / 2, z);
      const mount = new THREE.Group();
      mount.name = path.def.name + '-overrun-detector';
      mount.position.set(x, at.y, z); mount.rotation.y = heading;
      const pivot = new THREE.Group(); mount.add(pivot);
      const length = 2 * reach;
      for (let i = 0; i < 6; i++) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, length / 6, 8), i % 2 ? white : orange);
        band.rotation.z = Math.PI / 2;
        band.position.x = -side * (i + .5) * length / 6;
        pivot.add(band);
      }
      this.group.add(post, mount);
      this.gates.push({ pivot, hit: Infinity, at, side });
    }
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  trigger(lift: number) { const gate = this.gates[lift]; if (gate) gate.hit = 0; }
  position(lift: number) { return this.gates[lift]?.at; }

  update(dt: number) {
    for (const gate of this.gates) {
      if (!Number.isFinite(gate.hit)) continue;
      gate.hit += dt;
      gate.pivot.rotation.y = -gate.side * 1.65 * Math.exp(-2.8 * gate.hit) * Math.sin(10 * gate.hit);
      if (gate.hit > 3) { gate.hit = Infinity; gate.pivot.rotation.y = 0; }
    }
  }
}

function signMaterial(first: string, second: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 240;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffcf26'; g.fillRect(0, 0, 256, 240);
  g.strokeStyle = '#252627'; g.lineWidth = 7; g.strokeRect(7, 7, 242, 226);
  g.fillStyle = '#17191b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 48px Helvetica, Arial, sans-serif'; g.fillText(first, 128, 86, 222);
  g.font = 'bold 58px Helvetica, Arial, sans-serif'; g.fillText(second, 128, 160, 222);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardNodeMaterial({ map, roughness: .72 });
}
