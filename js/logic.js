// Calculs purs de la caisse Kartel BBS : périodes, montants, statistiques, export. Aucun accès au DOM.
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MOIS_COURTS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pad = (n) => String(n).padStart(2, '0');

let seq = 0;
export const uid = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

// Périodes en heure locale ; `end` est exclu. La semaine va du lundi au dimanche.
export function periodRange(kind, anchor) {
  const a = new Date(anchor);
  let start;
  let end;
  if (kind === 'day' || kind === 'week') {
    start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    if (kind === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = new Date(start);
    end.setDate(end.getDate() + (kind === 'week' ? 7 : 1));
  } else if (kind === 'month') {
    start = new Date(a.getFullYear(), a.getMonth(), 1);
    end = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  } else {
    start = new Date(a.getFullYear(), 0, 1);
    end = new Date(a.getFullYear() + 1, 0, 1);
  }
  return { start: start.getTime(), end: end.getTime() };
}

export function shiftPeriod(kind, anchor, delta) {
  const a = new Date(anchor);
  if (kind === 'month') return new Date(a.getFullYear(), a.getMonth() + delta, 1).getTime();
  if (kind === 'year') return new Date(a.getFullYear() + delta, 0, 1).getTime();
  a.setDate(a.getDate() + delta * (kind === 'week' ? 7 : 1));
  return a.getTime();
}

export function periodLabel(kind, anchor) {
  const a = new Date(anchor);
  if (kind === 'day') return `${cap(JOURS[a.getDay()])} ${a.getDate()} ${MOIS[a.getMonth()]} ${a.getFullYear()}`;
  if (kind === 'week') {
    const { start, end } = periodRange('week', anchor);
    const s = new Date(start);
    const e = new Date(end - 1);
    return s.getMonth() === e.getMonth()
      ? `Semaine du ${s.getDate()} au ${e.getDate()} ${MOIS[e.getMonth()]}`
      : `Semaine du ${s.getDate()} ${MOIS[s.getMonth()]} au ${e.getDate()} ${MOIS[e.getMonth()]}`;
  }
  if (kind === 'month') return `${cap(MOIS[a.getMonth()])} ${a.getFullYear()}`;
  return String(a.getFullYear());
}

// « 1 234 € » (espace fine insécable pour les milliers), « 12,50 € ».
export function eur(n) {
  const cents = Math.round(Math.abs(n) * 100);
  const int = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const dec = cents % 100;
  return `${n < 0 ? '-' : ''}${int}${dec ? ',' + pad(dec) : ''}\u00A0€`;
}

export const fmtDate = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const ticketTotal = (t) => t.items.reduce((sum, it) => sum + it.price * it.qty, 0);

// Un pointage resté ouvert un jour précédent est un « départ oublié » : il ne compte pas tant qu'il n'est pas corrigé.
export const isForgotten = (sh, now = Date.now()) => sh.end == null && sh.start < periodRange('day', now).start;

export function shiftDuration(sh, now = Date.now()) {
  if (sh.end != null) return Math.max(0, sh.end - sh.start);
  return isForgotten(sh, now) ? 0 : Math.max(0, now - sh.start);
}

export function hoursLabel(ms) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${pad(m)}` : `${h} h`;
}

const blank = () => ({ ca: 0, cb: 0, especes: 0, presta: 0, produit: 0, tickets: 0, coupes: 0, hours: 0 });

// Coupes = tickets contenant au moins une prestation (une vente de produit seule n'est pas une coupe).
export function computeStats(state, range, now = Date.now()) {
  const inRange = (ts) => ts >= range.start && ts < range.end;
  const out = { ...blank(), panier: 0, byBarber: {}, topPresta: [], topProduit: [] };
  const tops = { presta: {}, produit: {} };
  const row = (id) => (out.byBarber[id] ??= blank());

  for (const t of state.tickets) {
    if (!inRange(t.ts)) continue;
    const b = row(t.barberId);
    let total = 0;
    let hasPresta = false;
    for (const it of t.items) {
      const v = it.price * it.qty;
      total += v;
      out[it.kind] += v;
      b[it.kind] += v;
      if (it.kind === 'presta') hasPresta = true;
      const e = (tops[it.kind][it.name] ??= { name: it.name, qty: 0, ca: 0 });
      e.qty += it.qty;
      e.ca += v;
    }
    for (const o of [out, b]) {
      o.ca += total;
      o[t.pay] += total;
      o.tickets += 1;
      if (hasPresta) o.coupes += 1;
    }
  }

  for (const sh of state.shifts) {
    if (!inRange(sh.start)) continue;
    const ms = shiftDuration(sh, now);
    out.hours += ms;
    row(sh.barberId).hours += ms;
  }

  out.panier = out.tickets ? out.ca / out.tickets : 0;
  const sortTop = (m) => Object.values(m).sort((x, y) => y.ca - x.ca || y.qty - x.qty);
  out.topPresta = sortTop(tops.presta);
  out.topProduit = sortTop(tops.produit);
  return out;
}

// Barbers actifs, plus les anciens qui ont encaissé sur la période.
export function ranking(state, range, metric = 'ca', now = Date.now()) {
  const st = computeStats(state, range, now);
  return state.barbers
    .map((b) => ({ id: b.id, name: b.name, active: b.active, ca: st.byBarber[b.id]?.ca || 0, coupes: st.byBarber[b.id]?.coupes || 0 }))
    .filter((r) => r.active || r.ca > 0 || r.coupes > 0)
    .sort((x, y) => y[metric] - x[metric] || y.ca - x.ca || x.name.localeCompare(y.name))
    .map(({ id, name, ca, coupes }) => ({ id, name, ca, coupes }));
}

// Barres du graphique : jours de la semaine, jours du mois ou mois de l'année.
export function series(state, kind, anchor) {
  if (kind === 'day') return [];
  const { start, end } = periodRange(kind, anchor);
  const buckets = [];
  if (kind === 'year') {
    const y = new Date(start).getFullYear();
    for (let m = 0; m < 12; m++) {
      buckets.push({ label: MOIS_COURTS[m], start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime(), value: 0 });
    }
  } else {
    for (let t = start, i = 0; t < end; i++) {
      const next = shiftPeriod('day', t, 1);
      buckets.push({ label: kind === 'week' ? JOURS_COURTS[i] : String(new Date(t).getDate()), start: t, end: next, value: 0 });
      t = next;
    }
  }
  for (const tk of state.tickets) {
    if (tk.ts < start || tk.ts >= end) continue;
    const b = buckets.find((x) => tk.ts >= x.start && tk.ts < x.end);
    if (b) b.value += ticketTotal(tk);
  }
  return buckets.map(({ label, value }) => ({ label, value }));
}

const csvCell = (v) => {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

// CSV lisible directement par Excel FR (BOM, point-virgule, virgule décimale) et Google Sheets.
export function toCSV(state, range) {
  const names = Object.fromEntries(state.barbers.map((b) => [b.id, b.name]));
  const rows = [['Date', 'Heure', 'Barber', 'Type', 'Article', 'Qté', 'Prix unitaire', 'Total', 'Paiement']];
  const tickets = state.tickets.filter((t) => t.ts >= range.start && t.ts < range.end).sort((a, b) => a.ts - b.ts);
  for (const t of tickets) {
    for (const it of t.items) {
      rows.push([
        fmtDate(t.ts), fmtTime(t.ts), names[t.barberId] || 'Inconnu',
        it.kind === 'presta' ? 'Prestation' : 'Produit', it.name, it.qty,
        csvNum(it.price), csvNum(it.price * it.qty), t.pay === 'cb' ? 'CB' : 'Espèces',
      ]);
    }
  }
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function validateState(s) {
  return Boolean(s)
    && s.v === 1
    && typeof s.salon === 'object' && s.salon !== null
    && ['barbers', 'tickets', 'shifts'].every((k) => Array.isArray(s[k]))
    && Boolean(s.catalog) && Array.isArray(s.catalog.prestations) && Array.isArray(s.catalog.produits)
    && typeof s.meta === 'object' && s.meta !== null;
}
