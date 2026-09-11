// Données fictives pour présenter la caisse (lien « ?demo »). Stockées à part, jamais mélangées aux vraies.
import { defaultState } from './catalog.js';

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoState(now = Date.now()) {
  const r = mulberry32(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const s = defaultState(now);
  s.salon.name = 'Salon démo';
  s.barbers = ['Yanis', 'Moussa', 'Kevin', 'Ilyes'].map((name, i) => ({ id: 'demo' + i, name, active: true }));

  const courant = s.catalog.prestations.filter((p) => p.group === 'Coupes & barbe');
  const autres = s.catalog.prestations.filter((p) => p.group !== 'Coupes & barbe');
  let n = 0;
  const id = () => 'x' + (n++).toString(36);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let back = 180; back >= 0; back--) {
    const day = new Date(today);
    day.setDate(day.getDate() - back);
    for (const b of s.barbers) {
      if (r() < 0.18) continue; // jour de repos
      const start = new Date(day);
      start.setHours(9 + Math.floor(r() * 3), Math.floor(r() * 60));
      const end = new Date(day);
      end.setHours(18 + Math.floor(r() * 3), Math.floor(r() * 60));
      if (start.getTime() > now) continue;
      const live = back === 0;
      s.shifts.push({ id: id(), barberId: b.id, start: start.getTime(), end: live ? null : end.getTime() });
      const stop = live ? Math.min(now, end.getTime()) : end.getTime();
      for (let t = start.getTime() + (10 + r() * 30) * 60e3; t < stop; t += (25 + r() * 35) * 60e3) {
        const p = r() < 0.85 ? pick(courant) : pick(autres);
        const items = [{ kind: 'presta', name: p.name, price: p.price, qty: 1 }];
        if (r() < 0.12) {
          const q = pick(s.catalog.produits);
          items.push({ kind: 'produit', name: q.name, price: q.price, qty: 1 });
        }
        s.tickets.push({ id: id(), ts: Math.round(t), barberId: b.id, pay: r() < 0.62 ? 'cb' : 'especes', items });
      }
    }
  }
  s.meta.lastBackupAt = now;
  s.meta.setupDone = true;
  return s;
}
