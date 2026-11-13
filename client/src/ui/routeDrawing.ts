import type { MapRoute, RouteMode } from '../../../shared/skiNavigation';

export const ROUTE_COLORS: Record<RouteMode, string> = { ski: '#00d6ed', lift: '#cc9cff', walk: '#ffbc65' };
export function drawMapRoutes(g: CanvasRenderingContext2D, routes: MapRoute[], project: (x: number, z: number) => number[], labels = true) {
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  // Local guidance goes on top. Friends retain their jacket color.
  for (const route of [...routes].sort((a, b) => Number(!!a.self) - Number(!!b.self))) {
    for (const leg of route.route?.legs ?? []) {
      g.beginPath();
      leg.points.forEach((p, i) => { const [x, y] = project(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.setLineDash(leg.mode === 'lift' ? [10, 6] : leg.mode === 'walk' ? [2, 6] : []);
      g.strokeStyle = 'rgba(4,24,39,.85)'; g.lineWidth = route.self ? 7 : 5; g.stroke();
      g.strokeStyle = route.self ? ROUTE_COLORS[leg.mode] : route.color; g.lineWidth = route.self ? 3.5 : 2; g.stroke();
    }
    g.setLineDash([]);
    const [x, y] = project(route.destination.x, route.destination.z);
    g.fillStyle = route.self ? ROUTE_COLORS.ski : route.color; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y - 12); g.arc(x, y - 15, 9, Math.PI * .9, Math.PI * 2.1); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#102537'; g.beginPath(); g.arc(x, y - 15, 3, 0, Math.PI * 2); g.fill();
    if (labels) {
      g.font = 'bold 12px -apple-system, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
      const label = route.self ? 'Your pin' : `${route.name}’s pin`;
      g.lineWidth = 4; g.strokeStyle = '#102537'; g.strokeText(label, x, y - 28); g.fillStyle = '#fff'; g.fillText(label, x, y - 28);
    }
  }
  g.restore();
}
