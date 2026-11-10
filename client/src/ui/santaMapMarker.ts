import type { SantaLitFir, SantaTrack } from '../../../shared/santaFestivities';

export const SANTA_MAP_LABEL = 'Santa';
export interface SantaMapTraces { firs: readonly SantaLitFir[]; tracks: readonly SantaTrack[] }

export function drawSantaMapTraces(g: CanvasRenderingContext2D, traces: SantaMapTraces,
  project: (x: number, z: number) => readonly number[], size: number) {
  g.save();
  g.beginPath();
  for (let i = 0; i < traces.tracks.length; i++) {
    const [, x, z, edge] = traces.tracks[i], [sx, sy] = project(x, z);
    if (i === 0 || edge < 0) g.moveTo(sx, sy);
    else g.lineTo(sx, sy);
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.setLineDash([2, 5]);
  g.strokeStyle = '#674028';
  g.lineWidth = 4;
  g.stroke();
  g.strokeStyle = '#ffdb8e';
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);
  for (const { anchor } of traces.firs) {
    const [x, y] = project(anchor.x, anchor.z);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5 - Math.PI / 2, r = size * (i % 2 ? .43 : 1);
      const sx = x + Math.cos(angle) * r, sy = y + Math.sin(angle) * r;
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.closePath();
    g.lineWidth = 3;
    g.strokeStyle = '#603322';
    g.stroke();
    g.fillStyle = '#ffd778';
    g.fill();
  }
  g.restore();
}

/** A stocking hat on a red map badge, distinct from the player arrows and lift symbols. */
export function drawSantaMapMarker(g: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  g.save();
  g.translate(x, y);
  g.scale(radius / 12, radius / 12);
  g.beginPath();
  g.arc(0, 0, 11, 0, 2 * Math.PI);
  g.fillStyle = '#851d36';
  g.fill();
  g.strokeStyle = '#172035';
  g.lineWidth = 4;
  g.stroke();
  g.strokeStyle = '#ffdfa2';
  g.lineWidth = 1.7;
  g.stroke();

  g.beginPath();
  g.moveTo(-6.7, 3.5);
  g.bezierCurveTo(-5.8, -.9, -3.5, -5.5, -.2, -6.4);
  g.bezierCurveTo(3.2, -7.5, 5.3, -4.8, 6.6, -2.5);
  g.lineTo(2.6, -2.2);
  g.lineTo(4.9, 3.5);
  g.closePath();
  g.fillStyle = '#ff5969';
  g.fill();
  g.beginPath();
  g.roundRect(-7.3, 2.5, 13, 3.4, 1.7);
  g.moveTo(8.2, -2.1);
  g.arc(6.5, -2.1, 1.7, 0, Math.PI * 2);
  g.fillStyle = '#fff9eb';
  g.fill();
  g.restore();
}
