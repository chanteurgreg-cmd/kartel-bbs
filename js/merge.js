// Synchronisation entre appareils (tablettes du salon, téléphone du patron) : fusion de deux états de caisse.
// Chaque fiche (ticket, pointage, barber, article de la carte, et le salon lui-même) porte `u`, l'heure de sa
// dernière modification ; une suppression laisse une trace dans `del` ({ "collection:id": heure }). Pour chaque
// fiche, la version la plus récente gagne, et une suppression plus récente que la fiche l'efface. Le résultat ne
// dépend pas de l'ordre des copies : la fonction en ligne et chaque appareil l'appliquent sans se contredire.
// Aucune dépendance : ce fichier est aussi déployé tel quel dans la fonction Supabase kartel-backup.

const LISTS = [
  ['tickets', (s) => s.tickets, (s, v) => { s.tickets = v; }],
  ['shifts', (s) => s.shifts, (s, v) => { s.shifts = v; }],
  ['barbers', (s) => s.barbers, (s, v) => { s.barbers = v; }],
  ['prestations', (s) => s.catalog.prestations, (s, v) => { s.catalog.prestations = v; }],
  ['produits', (s) => s.catalog.produits, (s, v) => { s.catalog.produits = v; }],
];

const stamp = (r) => r?.u || 0;

// La carte type réutilise les mêmes identifiants d'une liste à l'autre : la trace porte le nom de la collection.
const delKey = (name, id) => `${name}:${id}`;

// Texte d'une fiche indépendant de l'ordre des champs (la base les range à sa façon).
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));

// Version retenue entre deux copies d'une même fiche : la plus récente ; à égalité (anciennes fiches sans `u`),
// un ordre fixe sur le contenu, pour que tous les appareils choisissent la même.
function newer(a, b) {
  if (a === b || !b) return a;
  const d = stamp(b) - stamp(a);
  if (d) return d > 0 ? b : a;
  return canon(b) > canon(a) ? b : a;
}

function mergeList(name, mine, theirs, del) {
  const pick = new Map(mine.map((r) => [r.id, r]));
  const order = mine.map((r) => r.id);
  for (const r of theirs) {
    const cur = pick.get(r.id);
    if (cur) pick.set(r.id, newer(cur, r));
    else {
      pick.set(r.id, r);
      order.push(r.id);
    }
  }
  const list = [];
  for (const id of new Set(order)) {
    const r = pick.get(id);
    const gone = del[delKey(name, id)];
    if (gone == null || gone < stamp(r)) list.push(r);
  }
  const changed = list.length !== mine.length || list.some((r, i) => r !== mine[i]);
  return { list, changed };
}

// « mine » : l'état de cet appareil, dont on garde les réglages propres (`meta`). Renvoie { state, changed } ;
// changed : « theirs » a apporté du nouveau à « mine ».
export function mergeStates(mine, theirs) {
  if (!theirs) return { state: mine, changed: false };
  const del = { ...(mine.del || {}) };
  let changed = false;
  for (const [k, ts] of Object.entries(theirs.del || {})) {
    if (!(del[k] >= ts)) {
      del[k] = ts;
      changed = true;
    }
  }
  const salon = newer(mine.salon, theirs.salon);
  if (salon !== mine.salon) changed = true;
  const state = { ...mine, salon, catalog: { ...mine.catalog }, del };
  for (const [name, get, set] of LISTS) {
    const r = mergeList(name, get(mine) || [], get(theirs) || [], del);
    set(state, r.list);
    if (r.changed) changed = true;
  }
  return { state, changed };
}

// Compare l'état à la photo prise au dernier enregistrement : fiche nouvelle ou modifiée → `u` = maintenant,
// fiche disparue → trace de suppression. Renvoie la nouvelle photo. Sans photo (premier chargement), rien n'est daté.
export function stampChanges(state, snapshot, now = Date.now()) {
  const next = new Map();
  state.del ??= {};
  const visit = (k, r) => {
    let text = JSON.stringify(r);
    if (snapshot && snapshot.get(k) !== text) {
      r.u = Math.max(now, stamp(r) + 1);
      text = JSON.stringify(r);
    }
    next.set(k, text);
  };
  for (const [name, get] of LISTS) for (const r of get(state)) visit(delKey(name, r.id), r);
  visit('salon', state.salon);
  if (snapshot) {
    for (const k of snapshot.keys()) if (!next.has(k)) state.del[k] = now;
  }
  return next;
}

// Envoi d'une ancienne version de la caisse (sans dates ni traces de suppression) : elle était seule à écrire,
// donc pour les fiches sans date c'est elle qui fait foi. On ne garde de la copie en ligne que ce que les
// nouvelles versions ont daté, puis on fusionne : rien de ce que le téléphone a fait n'est perdu.
export function datedOnly(stored) {
  const keep = (list) => (list || []).filter((r) => r.u);
  return {
    ...stored,
    salon: stored.salon?.u ? stored.salon : undefined,
    tickets: keep(stored.tickets),
    shifts: keep(stored.shifts),
    barbers: keep(stored.barbers),
    catalog: { prestations: keep(stored.catalog?.prestations), produits: keep(stored.catalog?.produits) },
  };
}
