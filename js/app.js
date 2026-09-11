// Caisse Kartel BBS : écrans de la tablette (gabarits HTML + délégation d'événements).
import {
  periodRange, shiftPeriod, periodLabel, eur, ticketTotal, computeStats, shiftDuration, isForgotten,
  hoursLabel, ranking, series, toCSV, validateState, fmtDate, fmtTime, uid,
} from './logic.js';
import { defaultState, DEFAULT_CATALOG, GROUPS } from './catalog.js';
import { demoState } from './demo.js';
import * as store from './store.js';
import * as cloud from './cloud.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const DAY = 86400000;
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let S = null; // état complet (voir la spec)
const ui = {
  view: 'comptoir',
  stats: { kind: 'day', anchor: Date.now() },
  rank: { kind: 'week', anchor: Date.now(), metric: 'ca' },
  hist: { kind: 'day', anchor: Date.now() },
  setup: null, // étape 1 : { step: 1, name, barbers } ; étape 2 : { step: 2, chosen }
  sale: null, // { barberId, tab: 'presta' | 'produit', items: [] }
  other: null, // { digits, kind, label } : pavé « Autre montant »
  modal: null, // { text, ok, onOk }
  flick: null, // barber qui vient de pointer : son néon s'allume
  enter: {}, // animations d'entrée à jouer une seule fois au prochain rendu (view, sale, other, modal)
  closing: false, // la fenêtre d'encaissement est en train de se refermer
  lastGroup: 'Coupes & barbe',
  showKey: false, // code de récupération affiché en clair dans Réglages
};

const TABS = [
  ['comptoir', 'Comptoir', 'scissors'],
  ['chiffres', 'Chiffres', 'chart'],
  ['classement', 'Classement', 'podium'],
  ['historique', 'Historique', 'clock'],
  ['reglages', 'Réglages', 'sliders'],
];
const KIND_LABEL = { day: 'Jour', week: 'Semaine', month: 'Mois', year: 'Année' };
const PAY_LABEL = { cb: 'CB', especes: 'Espèces' };

// ——— Utilitaires ———

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'salon';
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
const barberName = (id) => S.barbers.find((b) => b.id === id)?.name ?? 'Inconnu';
const activeBarbers = () => S.barbers.filter((b) => b.active);
const openShift = (id, now = Date.now()) => S.shifts.find((sh) => sh.barberId === id && sh.end == null && !isForgotten(sh, now));
const priceText = (n) => String(n).replace('.', ',');
const lastSafe = () => Math.max(S.meta.lastBackupAt || 0, S.meta.cloudAt || 0);
const backupLate = () => !DEMO && S.tickets.length > 0 && Date.now() - lastSafe() > 2 * DAY;
const familiesOf = (items) => {
  const present = [...new Set(items.map((p) => p.group || 'Autres'))];
  return [...GROUPS.filter((g) => present.includes(g)), ...present.filter((g) => !GROUPS.includes(g))];
};

function parsePrice(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// Enregistre dans la tablette, puis programme la copie en ligne.
function persist() {
  store.save(S);
  markDirty();
}

function save(rerender = true) {
  persist();
  if (rerender) render();
}

// Icônes au trait, composées de formes simples (grille 24 px).
const ICONS = {
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/>',
  scissors: '<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.3 8.4L20 17.5M8.3 15.6L20 6.5"/>',
  chart: '<path d="M4 19.5h16M7.5 16v-4.5M12 16V7M16.5 16V10"/>',
  podium: '<path d="M9 19.5V8.5h6v11M3.5 19.5v-7H9M15 19.5v-5h5.5v5M2.5 19.5h19"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
};
const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const HEXROW = `<svg class="hexrow" viewBox="0 0 2400 58" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${Array.from({ length: 43 }, (_, i) => {
  const x = 20 + i * 56;
  return `<polygon points="${x},4 ${x + 28},4 ${x + 42},29 ${x + 28},54 ${x},54 ${x - 14},29"/>`;
}).join('')}</svg>`;
const LOGO = '<svg class="logo" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="45"/><text x="50" y="68" text-anchor="middle">K</text></svg>';

// ——— Rendu ———

const VIEWS = { comptoir: comptoirView, chiffres: chiffresView, classement: classementView, historique: historiqueView, reglages: reglagesView };

function render() {
  document.body.classList.toggle('locked', Boolean(ui.sale || ui.other || ui.modal));
  const scroll = {};
  app.querySelectorAll('[data-scroll]').forEach((el) => { scroll[el.dataset.scroll] = el.scrollTop; });
  const overlays = `${ui.sale ? saleView() : ''}${ui.other ? otherView() : ''}${ui.modal ? modalView() : ''}`;
  app.innerHTML = ui.setup
    ? setupView() + overlays
    : `${headerView()}<main class="view view-${ui.view}${ui.enter.view ? ' enter' : ''}">${VIEWS[ui.view]()}</main>${tabbarView('dock')}${overlays}`;
  app.querySelectorAll('[data-scroll]').forEach((el) => { el.scrollTop = scroll[el.dataset.scroll] || 0; });
  ui.flick = null;
  ui.enter = {};
}

function headerView() {
  const now = Date.now();
  return `
    <header class="topbar">
      <div class="topbar-in">
        <div class="brand">
          ${LOGO}
          <div class="brand-txt">
            <span class="wordmark">Kartel BBS</span>
            <span class="brand-sub"><span class="salon-name">${esc(S.salon.name)}</span> · ${esc(new Date(now).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
          </div>
          ${DEMO ? '<span class="badge">Démo</span>' : ''}
        </div>
        ${tabbarView('top')}
        <time class="clock" id="clock">${fmtTime(now)}</time>
      </div>
    </header>`;
}

// Deux barres identiques : en haut sur tablette et ordinateur, flottante en bas sur téléphone.
function tabbarView(where) {
  const late = backupLate();
  return `
    <nav class="tabbar tabbar-${where} glass" aria-label="Sections">
      ${TABS.map(([v, label, icon]) => `<button class="tab" data-action="nav" data-view="${v}"${ui.view === v ? ' aria-current="page"' : ''}>${ic(icon)}<span>${label}</span>${v === 'reglages' && late ? '<i class="dot-warn" title="Sauvegarde à faire"></i>' : ''}</button>`).join('')}
    </nav>`;
}

const kpi = (label, value, tone = '') => `
  <div class="card kpi ${tone}">
    <span class="kpi-label">${tone ? `<i class="dot ${tone}"></i>` : ''}${label}</span>
    <strong class="kpi-value">${value}</strong>
  </div>`;

function splitBar(cb, esp) {
  const total = cb + esp;
  if (!total) return '<div class="split" aria-hidden="true"></div>';
  const p = Math.round((cb / total) * 100);
  return `
    <div class="split" role="img" aria-label="CB ${p} %, espèces ${100 - p} %"><span class="cb" style="width:${p}%"></span><span class="esp" style="width:${100 - p}%"></span></div>
    <div class="split-legend"><span class="t-cb">CB ${p} %</span><span class="t-esp">Espèces ${100 - p} %</span></div>`;
}

// ——— Comptoir ———

function comptoirView() {
  const now = Date.now();
  const st = computeStats(S, periodRange('day', now), now);
  const team = activeBarbers();
  return `
    <h2 class="large-title">Aujourd'hui</h2>
    <section class="today" aria-label="Chiffres du jour">
      <div class="card kpi hero">
        <span class="kpi-label">Chiffre d'affaires du jour</span>
        <strong class="kpi-value">${eur(st.ca)}</strong>
        ${splitBar(st.cb, st.especes)}
      </div>
      ${kpi('CB', eur(st.cb), 'cb')}
      ${kpi('Espèces', eur(st.especes), 'esp')}
      ${kpi('Coupes', st.coupes)}
    </section>
    <h3 class="section-title">Équipe</h3>
    ${team.length
      ? `<p class="section-sub">Touche la carte d'un barber pour encaisser.</p>
         <section class="barbers" aria-label="Équipe">${team.map((b) => barberCard(b, st.byBarber[b.id], now)).join('')}</section>`
      : `<div class="card empty-state"><p>Aucun barber dans l'équipe.</p><button class="btn primary" data-action="nav" data-view="reglages">Ajouter un barber</button></div>`}`;
}

function barberCard(b, st, now) {
  const sh = openShift(b.id, now);
  const on = Boolean(sh);
  return `
    <article class="barber${on ? ' on' : ''}${ui.flick === b.id ? ' flick' : ''}">
      <button class="barber-main" data-action="sale" data-id="${b.id}" aria-label="Encaisser pour ${esc(b.name)}">
        <span class="b-top">
          <span class="avatar" aria-hidden="true">${esc(initials(b.name))}</span>
          <span class="b-id"><span class="b-name">${esc(b.name)}</span><span class="b-status">${on ? `Au poste depuis ${fmtTime(sh.start)}` : 'Pas pointé'}</span></span>
        </span>
        <span class="b-ca">${eur(st?.ca || 0)}</span>
        <span class="b-meta">${plural(st?.coupes || 0, 'coupe', 'coupes')} aujourd'hui</span>
        <span class="b-cta">Encaisser ${ic('chev')}</span>
      </button>
      <button class="punch glass ${on ? 'out' : 'in'}" data-action="punch" data-id="${b.id}">${on ? 'Départ' : 'Arrivée'}</button>
    </article>`;
}

function punch(id) {
  const now = Date.now();
  const name = barberName(id);
  const sh = openShift(id, now);
  if (sh) {
    sh.end = now;
    save();
    toast(`Départ de ${name} à ${fmtTime(now)}`, () => { sh.end = null; save(); });
  } else {
    const fresh = { id: uid(), barberId: id, start: now, end: null };
    S.shifts.push(fresh);
    ui.flick = id;
    save();
    toast(`Arrivée de ${name} à ${fmtTime(now)}`, () => {
      S.shifts = S.shifts.filter((x) => x.id !== fresh.id);
      save();
    });
  }
}

// ——— Encaisser ———

function saleView() {
  const s = ui.sale;
  const list = s.tab === 'presta' ? S.catalog.prestations : S.catalog.produits;
  const total = s.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const count = s.items.reduce((n, it) => n + it.qty, 0);
  const qtyOf = (p) => s.items.filter((it) => it.kind === s.tab && it.name === p.name && it.price === p.price).reduce((n, it) => n + it.qty, 0);
  const btn = (p) => {
    const q = qtyOf(p);
    return `<button class="item${q ? ' picked' : ''}" data-action="add" data-id="${p.id}">
      <span class="i-name">${esc(p.name)}</span><span class="i-price">${eur(p.price)}</span>${q ? `<span class="i-qty">${q}</span>` : ''}
    </button>`;
  };
  let body;
  if (!list.length) {
    body = '<p class="muted pad">Rien dans la carte pour l\'instant. Ajoute des tarifs dans Réglages, ou utilise « Autre montant ».</p>';
  } else if (s.tab === 'presta') {
    body = familiesOf(list).map((g) => `<h3 class="g-title">${esc(g)}</h3><div class="grid">${list.filter((p) => (p.group || 'Autres') === g).map(btn).join('')}</div>`).join('');
  } else {
    body = `<div class="grid top-gap">${list.map(btn).join('')}</div>`;
  }
  const name = esc(barberName(s.barberId));
  const anim = ui.enter.sale ? ' enter' : '';
  return `
    <div class="scrim${anim}" data-action="sale-close" aria-hidden="true"></div>
    <div class="sheet glass${anim}" role="dialog" aria-modal="true" aria-label="Encaisser pour ${name}">
      <div class="sheet-pick" data-scroll="pick">
        <header class="sheet-head">
          <button class="icon-btn lg glass" data-action="sale-close" aria-label="Fermer sans enregistrer">${ic('x')}</button>
          <div><span class="sheet-kicker">Encaisser</span><h2 class="sheet-name">${name}</h2></div>
        </header>
        <div class="seg" role="group" aria-label="Type d'article">
          <button data-action="sale-tab" data-tab="presta" aria-pressed="${s.tab === 'presta'}">Prestations</button>
          <button data-action="sale-tab" data-tab="produit" aria-pressed="${s.tab === 'produit'}">Produits</button>
        </div>
        ${body}
        <button class="other-btn" data-action="other-open">${ic('plus')} Autre montant</button>
      </div>
      <aside class="ticket" aria-label="Ticket en cours">
        <div class="t-head"><h3>Ticket</h3><span>${count ? plural(count, 'article', 'articles') : ''}</span></div>
        <ul class="lines" data-scroll="lines">${s.items.length ? s.items.map(lineView).join('') : '<li class="empty">Touche une prestation ou un produit.</li>'}</ul>
        <div class="t-total"><span>Total</span><strong>${eur(total)}</strong></div>
        <div class="pay">
          <button class="pay-btn cb" data-action="pay" data-pay="cb"${s.items.length ? '' : ' disabled'}>${ic('card')} CB</button>
          <button class="pay-btn esp" data-action="pay" data-pay="especes"${s.items.length ? '' : ' disabled'}>${ic('cash')} Espèces</button>
        </div>
      </aside>
    </div>`;
}

const lineView = (it, i) => `
  <li class="line">
    <span class="l-name">${esc(it.name)}<small>${it.kind === 'presta' ? 'Prestation' : 'Produit'} · ${eur(it.price)}</small></span>
    <span class="stepper">
      <button class="icon-btn sm" data-action="qty" data-i="${i}" data-d="-1" aria-label="Enlever un ${esc(it.name)}">${ic('minus')}</button>
      <b>${it.qty}</b>
      <button class="icon-btn sm" data-action="qty" data-i="${i}" data-d="1" aria-label="Ajouter un ${esc(it.name)}">${ic('plus')}</button>
    </span>
    <span class="l-total">${eur(it.price * it.qty)}</span>
  </li>`;

function addItem(kind, p) {
  const hit = ui.sale.items.find((it) => it.kind === kind && it.name === p.name && it.price === p.price);
  if (hit) hit.qty += 1;
  else ui.sale.items.push({ kind, name: p.name, price: p.price, qty: 1 });
}

// La fenêtre redescend là d'où elle est venue avant de disparaître.
function closeSale() {
  const sheet = app.querySelector('.sheet');
  const done = () => {
    ui.closing = false;
    ui.sale = null;
    render();
  };
  if (!sheet || reduceMotion.matches) { done(); return; }
  ui.closing = true;
  sheet.classList.add('leave');
  app.querySelector('.scrim')?.classList.add('leave');
  setTimeout(done, 240);
}

function otherView() {
  const o = ui.other;
  const value = parsePrice(o.digits) || 0;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];
  const anim = ui.enter.other ? ' enter' : '';
  return `
    <div class="modal-back${anim}">
      <div class="modal${anim}" role="dialog" aria-modal="true" aria-labelledby="other-title">
        <h3 id="other-title" class="m-title">Autre montant</h3>
        <div class="seg full" role="group" aria-label="Type">
          <button data-action="other-kind" data-kind="presta" aria-pressed="${o.kind === 'presta'}">Prestation</button>
          <button data-action="other-kind" data-kind="produit" aria-pressed="${o.kind === 'produit'}">Produit</button>
        </div>
        <input class="input" id="other-label" maxlength="40" placeholder="Libellé (facultatif)" value="${esc(o.label)}" autocomplete="off">
        <output class="amount" aria-live="polite">${o.digits ? esc(o.digits.replace('.', ',')) : '0'} €</output>
        <div class="keypad">${keys.map((k) => `<button data-action="key" data-k="${k}"${k === 'del' ? ' aria-label="Effacer"' : ''}>${k === 'del' ? '⌫' : k}</button>`).join('')}</div>
        <div class="m-actions">
          <button class="btn" data-action="other-cancel">Annuler</button>
          <button class="btn primary" data-action="other-ok"${value > 0 ? '' : ' disabled'}>Ajouter${value > 0 ? ` ${eur(value)}` : ''}</button>
        </div>
      </div>
    </div>`;
}

function pressKey(k) {
  const o = ui.other;
  if (k === 'del') {
    o.digits = o.digits.slice(0, -1);
  } else if (k === ',') {
    if (!o.digits.includes('.')) o.digits = `${o.digits || '0'}.`;
  } else {
    const [int, dec] = o.digits.split('.');
    const room = dec !== undefined ? dec.length < 2 : int.length < 5;
    if (room) o.digits = o.digits === '0' ? k : o.digits + k;
  }
}

function pay(mode) {
  const s = ui.sale;
  if (!s?.items.length || ui.closing) return;
  const t = { id: uid(), ts: Date.now(), barberId: s.barberId, pay: mode, items: s.items.map((it) => ({ ...it })) };
  S.tickets.push(t);
  persist();
  closeSale();
  toast(`${eur(ticketTotal(t))} en ${PAY_LABEL[mode]} · ${barberName(t.barberId)}`, () => {
    S.tickets = S.tickets.filter((x) => x.id !== t.id);
    save();
    toast('Encaissement annulé');
  });
}

// ——— Barre de période (Chiffres, Classement, Historique) ———

function periodBar(scope, kinds) {
  const p = ui[scope];
  const isNow = periodRange(p.kind, p.anchor).start === periodRange(p.kind, Date.now()).start;
  return `
    <div class="periodbar">
      ${kinds.length > 1 ? `<div class="seg" role="group" aria-label="Période">${kinds.map((k) => `<button data-action="period" data-scope="${scope}" data-kind="${k}" aria-pressed="${p.kind === k}">${KIND_LABEL[k]}</button>`).join('')}</div>` : ''}
      <div class="pnav">
        <button class="icon-btn glass" data-action="shift" data-scope="${scope}" data-d="-1" aria-label="Période précédente">${ic('left')}</button>
        <span class="p-label">${esc(periodLabel(p.kind, p.anchor))}</span>
        <button class="icon-btn glass" data-action="shift" data-scope="${scope}" data-d="1" aria-label="Période suivante"${isNow ? ' disabled' : ''}>${ic('right')}</button>
        ${isNow ? '' : `<button class="btn sm" data-action="today" data-scope="${scope}">Aujourd'hui</button>`}
      </div>
    </div>`;
}

// ——— Chiffres ———

function chiffresView() {
  const now = Date.now();
  const { kind, anchor } = ui.stats;
  const st = computeStats(S, periodRange(kind, anchor), now);
  const ser = series(S, kind, anchor);
  const rows = S.barbers.filter((b) => b.active || st.byBarber[b.id]);
  const cell = (x, k) => (k === 'coupes' ? x.coupes || 0 : k === 'hours' ? hoursLabel(x.hours || 0) : eur(x[k] || 0));
  const cols = ['ca', 'cb', 'especes', 'coupes', 'produit', 'hours'];
  return `
    <h2 class="large-title">Chiffres</h2>
    ${periodBar('stats', ['day', 'week', 'month', 'year'])}
    <section class="kpis">
      <div class="card kpi hero">
        <span class="kpi-label">Chiffre d'affaires</span>
        <strong class="kpi-value">${eur(st.ca)}</strong>
        ${splitBar(st.cb, st.especes)}
      </div>
      ${kpi('CB', eur(st.cb), 'cb')}
      ${kpi('Espèces', eur(st.especes), 'esp')}
      ${kpi('Prestations', eur(st.presta))}
      ${kpi('Produits', eur(st.produit))}
      ${kpi('Coupes', st.coupes)}
      ${kpi('Panier moyen', eur(st.panier))}
      ${kpi('Tickets', st.tickets)}
      ${kpi('Heures pointées', hoursLabel(st.hours))}
    </section>
    ${ser.length ? barsView(ser, kind, anchor) : ''}
    <h3 class="group-title">Par barber</h3>
    <div class="group">
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th scope="col">Barber</th><th scope="col">CA</th><th scope="col">CB</th><th scope="col">Espèces</th><th scope="col">Coupes</th><th scope="col">Produits</th><th scope="col">Heures</th></tr></thead>
        <tbody>${rows.map((b) => {
          const x = st.byBarber[b.id] || {};
          return `<tr><th scope="row">${esc(b.name)}${b.active ? '' : ' <small>(parti)</small>'}</th>${cols.map((k) => `<td>${cell(x, k)}</td>`).join('')}</tr>`;
        }).join('')}</tbody>
        <tfoot><tr><th scope="row">Total</th>${cols.map((k) => `<td>${cell(st, k)}</td>`).join('')}</tr></tfoot>
      </table></div>` : '<p class="row muted">Aucun barber.</p>'}
    </div>
    <div class="two">
      <div><h3 class="group-title">Top prestations</h3><div class="group">${topList(st.topPresta)}</div></div>
      <div><h3 class="group-title">Top produits</h3><div class="group">${topList(st.topProduit)}</div></div>
    </div>`;
}

const topList = (arr) => (arr.length
  ? arr.slice(0, 6).map((x, i) => `<div class="row top-row"><span class="rank-n">${i + 1}</span><span>${esc(x.name)}</span><small>× ${x.qty}</small><b>${eur(x.ca)}</b></div>`).join('')
  : '<p class="row muted">Rien sur cette période.</p>');

function barsView(ser, kind, anchor) {
  const max = Math.max(...ser.map((x) => x.value), 1);
  const now = new Date();
  const current = periodRange(kind, anchor).start === periodRange(kind, now.getTime()).start;
  const cur = !current ? -1 : kind === 'year' ? now.getMonth() : kind === 'week' ? (now.getDay() + 6) % 7 : now.getDate() - 1;
  const dense = ser.length > 12;
  const title = kind === 'year' ? 'CA par mois' : 'CA par jour';
  return `
    <section class="card chart">
      <h3>${title}</h3>
      <div class="bars${dense ? ' dense' : ''}" role="img" aria-label="${title}">
        ${ser.map((x, i) => `
          <div class="bar${i === cur ? ' cur' : ''}">
            <span class="b-val">${!dense && x.value ? eur(x.value) : ''}</span>
            <span class="b-track"><span class="b-col" style="height:${Math.round((x.value / max) * 100)}%"></span></span>
            <span class="b-lbl">${!dense || i === 0 || (i + 1) % 5 === 0 ? x.label : ''}</span>
          </div>`).join('')}
      </div>
    </section>`;
}

// ——— Classement ———

function classementView() {
  const list = ranking(S, periodRange(ui.rank.kind, ui.rank.anchor), ui.rank.metric);
  const byCa = ui.rank.metric === 'ca';
  const val = (x) => (byCa ? eur(x.ca) : plural(x.coupes, 'coupe', 'coupes'));
  const sub = (x) => (byCa ? plural(x.coupes, 'coupe', 'coupes') : eur(x.ca));
  const step = (i) => (list[i]
    ? `<div class="step p${i + 1}">
        <span class="medal">${i + 1}</span>
        <span class="r-name">${esc(list[i].name)}</span>
        <span class="r-val">${val(list[i])}</span>
        <span class="r-sub">${sub(list[i])}</span>
        <span class="plinth"></span>
      </div>`
    : '<div class="step empty"></div>');
  return `
    <h2 class="large-title">Classement</h2>
    <div class="rank-ctrl">
      ${periodBar('rank', ['week', 'month'])}
      <div class="seg" role="group" aria-label="Classer par">
        <button data-action="metric" data-m="ca" aria-pressed="${byCa}">Au CA</button>
        <button data-action="metric" data-m="coupes" aria-pressed="${!byCa}">Aux coupes</button>
      </div>
    </div>
    ${list.length
      ? `<section class="podium" aria-label="Podium">${step(1)}${step(0)}${step(2)}</section>
         ${list.length > 3 ? `<div class="group">${list.slice(3).map((x, i) => `<div class="row rank-row"><span class="rank-n">${i + 4}</span><span class="r-name">${esc(x.name)}</span><span class="r-sub">${sub(x)}</span><b>${val(x)}</b></div>`).join('')}</div>` : ''}`
      : '<p class="muted">Aucun barber dans l\'équipe.</p>'}`;
}

// ——— Historique ———

function historiqueView() {
  const now = Date.now();
  const r = periodRange('day', ui.hist.anchor);
  const inDay = (ts) => ts >= r.start && ts < r.end;
  const tickets = S.tickets.filter((t) => inDay(t.ts)).sort((a, b) => b.ts - a.ts);
  const shifts = S.shifts.filter((sh) => inDay(sh.start)).sort((a, b) => a.start - b.start);
  const forgotten = S.shifts.filter((sh) => isForgotten(sh, now));
  const st = computeStats(S, r, now);
  const team = activeBarbers();
  return `
    <h2 class="large-title">Historique</h2>
    ${forgotten.length ? `
      <h3 class="group-title">Départ oublié</h3>
      <div class="group warn">${forgotten.map((sh) => shiftRow(sh, true)).join('')}</div>
      <p class="group-foot">Indique l'heure de départ pour que ces heures soient comptées.</p>
      <div class="top-gap"></div>` : ''}
    ${periodBar('hist', ['day'])}
    <p class="daysum"><b>${eur(st.ca)}</b><span class="t-cb">CB ${eur(st.cb)}</span><span class="t-esp">Espèces ${eur(st.especes)}</span><span>${plural(st.tickets, 'ticket', 'tickets')}</span></p>
    <h3 class="group-title">Encaissements</h3>
    <div class="group">${tickets.length ? tickets.map(ticketRow).join('') : '<p class="row muted">Aucun encaissement ce jour-là.</p>'}</div>
    <h3 class="group-title">Pointages</h3>
    <div class="group">
      ${shifts.length ? shifts.map((sh) => shiftRow(sh, false)).join('') : '<p class="row muted">Aucun pointage ce jour-là.</p>'}
      ${team.length ? `
        <form class="row add-row shift-add" data-submit="shift-add">
          <select class="input" name="barber" aria-label="Barber">${team.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
          <label class="tfield">Arrivée <input class="input" type="time" name="start" required></label>
          <label class="tfield">Départ <input class="input" type="time" name="end"></label>
          <button class="btn sm">${ic('plus')} Ajouter un pointage</button>
        </form>` : ''}
    </div>`;
}

const summary = (t) => t.items.map((it) => (it.qty > 1 ? `${it.name} ×${it.qty}` : it.name)).join(', ');

const ticketRow = (t) => `
  <div class="row tk">
    <time>${fmtTime(t.ts)}</time>
    <span class="tk-main"><span class="tk-who">${esc(barberName(t.barberId))}</span><span class="tk-what">${esc(summary(t))}</span></span>
    <b class="tk-total">${eur(ticketTotal(t))}</b>
    <button class="paytag ${t.pay}" data-action="toggle-pay" data-id="${t.id}" aria-label="Payé en ${PAY_LABEL[t.pay]}, toucher pour changer">${PAY_LABEL[t.pay]}</button>
    <button class="icon-btn danger" data-action="del-ticket" data-id="${t.id}" aria-label="Supprimer ce ticket">${ic('trash')}</button>
  </div>`;

function shiftRow(sh, withDate) {
  const late = isForgotten(sh);
  return `
    <div class="row shift" data-shift="${sh.id}">
      <span class="sh-who">${esc(barberName(sh.barberId))}${withDate ? `<small>${fmtDate(sh.start)}</small>` : ''}</span>
      <label class="tfield">Arrivée <input class="input" type="time" value="${fmtTime(sh.start)}" data-change="shift-time" data-field="start" data-id="${sh.id}"></label>
      <label class="tfield">Départ <input class="input" type="time" value="${sh.end ? fmtTime(sh.end) : ''}" data-change="shift-time" data-field="end" data-id="${sh.id}"></label>
      <span class="sh-dur${late ? ' late' : ''}">${late ? 'à corriger' : hoursLabel(shiftDuration(sh))}</span>
      <button class="icon-btn danger" data-action="del-shift" data-id="${sh.id}" aria-label="Supprimer ce pointage">${ic('trash')}</button>
    </div>`;
}

function setShiftTime(id, field, value) {
  const sh = S.shifts.find((x) => x.id === id);
  if (!sh) return;
  const wasLate = isForgotten(sh);
  if (!value) {
    if (field === 'start') { render(); return; }
    sh.end = null;
  } else {
    const [h, m] = value.split(':').map(Number);
    const d = new Date(sh.start);
    d.setHours(h, m, 0, 0);
    const ts = d.getTime();
    if (field === 'start' && sh.end != null && ts >= sh.end) { toast("L'arrivée doit être avant le départ"); render(); return; }
    if (field === 'end' && ts <= sh.start) { toast("Le départ doit être après l'arrivée"); render(); return; }
    sh[field] = ts;
  }
  if (wasLate !== isForgotten(sh)) { save(); return; }
  save(false);
  const dur = app.querySelector(`[data-shift="${id}"] .sh-dur`);
  if (dur) dur.textContent = hoursLabel(shiftDuration(sh));
}

// ——— Carte des prix (premier lancement et Réglages) ———

const groupSelect = (current, attrs) => `<select class="input group-sel" ${attrs} aria-label="Famille">${GROUPS.map((g) => `<option${g === current ? ' selected' : ''}>${g}</option>`).join('')}</select>`;

function catalogEditor(list, title) {
  const isPresta = list === 'prestations';
  const items = S.catalog[list];
  const row = (p) => `
    <div class="row cat-row">
      <input class="input bare grow" data-change="cat" data-list="${list}" data-id="${p.id}" data-field="name" value="${esc(p.name)}" maxlength="40" aria-label="Nom" autocomplete="off">
      <span class="price-in"><input class="input" inputmode="decimal" data-change="cat" data-list="${list}" data-id="${p.id}" data-field="price" value="${priceText(p.price)}" aria-label="Prix de ${esc(p.name)} en euros"><i>€</i></span>
      ${isPresta ? groupSelect(p.group || 'Autres', `data-change="cat" data-list="${list}" data-id="${p.id}" data-field="group"`) : ''}
      <button class="icon-btn danger" data-action="cat-del" data-list="${list}" data-id="${p.id}" aria-label="Retirer ${esc(p.name)} de la carte">${ic('minus')}</button>
    </div>`;
  let body;
  if (!items.length) body = `<p class="row muted">${isPresta ? 'Aucune prestation pour l\'instant.' : 'Aucun produit pour l\'instant.'}</p>`;
  else if (isPresta) body = familiesOf(items).map((g) => `<p class="row sub-head">${esc(g)}</p>${items.filter((p) => (p.group || 'Autres') === g).map(row).join('')}`).join('');
  else body = items.map(row).join('');
  return `
    <section>
      <h3 class="group-title">${title}</h3>
      <div class="group">
        ${body}
        <form class="row add-row" data-submit="cat-add" data-list="${list}">
          <input class="input grow" name="name" placeholder="${isPresta ? 'Nouvelle prestation' : 'Nouveau produit'}" maxlength="40" required autocomplete="off" aria-label="Nom">
          <span class="price-in"><input class="input" name="price" inputmode="decimal" placeholder="Prix" required aria-label="Prix en euros"><i>€</i></span>
          ${isPresta ? groupSelect(ui.lastGroup, 'name="group"') : ''}
          <button class="btn primary sm">${ic('plus')} Ajouter</button>
        </form>
      </div>
    </section>`;
}

function addCatalogItem(list, name, price, group) {
  const item = { id: uid(), name, price };
  if (list === 'prestations') {
    item.group = group || ui.lastGroup;
    ui.lastGroup = item.group;
  }
  S.catalog[list].push(item);
}

// Une ligne remplie mais pas encore ajoutée n'est pas perdue en ouvrant la caisse.
function flushAddRows() {
  app.querySelectorAll('form[data-submit="cat-add"]').forEach((form) => {
    const name = form.querySelector('[name="name"]').value.trim();
    const price = parsePrice(form.querySelector('[name="price"]').value);
    if (name && price !== null) addCatalogItem(form.dataset.list, name, price, form.querySelector('[name="group"]')?.value);
  });
}

// ——— Réglages ———

function reglagesView() {
  const team = activeBarbers();
  const gone = S.barbers.filter((b) => !b.active);
  const months = [...new Set([monthKey(Date.now()), ...S.tickets.map((t) => monthKey(t.ts))])].sort().reverse();
  const years = [...new Set(months.map((k) => k.slice(0, 4)))];
  const monthName = (k) => periodLabel('month', new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1).getTime());
  return `
    <h2 class="large-title">Réglages</h2>
    <h3 class="group-title">Salon</h3>
    <div class="group">
      <label class="row field-row"><span>Nom du salon</span><input class="input bare" data-change="salon-name" value="${esc(S.salon.name)}" maxlength="40" autocomplete="off"></label>
    </div>
    <p class="group-foot">Affiché en haut de la caisse. Mets un nom différent sur la tablette de chaque salon.</p>

    <h3 class="group-title">Équipe</h3>
    <div class="group">
      ${team.map((b) => `
        <div class="row">
          <input class="input bare grow" data-change="barber-name" data-id="${b.id}" value="${esc(b.name)}" maxlength="24" aria-label="Nom du barber" autocomplete="off">
          <button class="btn sm plain" data-action="barber-leave" data-id="${b.id}">A quitté le salon</button>
        </div>`).join('')}
      <form class="row add-row" data-submit="barber-add">
        <input class="input grow" name="name" placeholder="Nom du nouveau barber" maxlength="24" required autocomplete="off" aria-label="Nom du nouveau barber">
        <button class="btn primary sm">${ic('plus')} Ajouter</button>
      </form>
      ${gone.length ? `
        <details class="gone">
          <summary>Anciens barbers (${gone.length})</summary>
          ${gone.map((b) => `<div class="row"><span class="gone-name">${esc(b.name)}</span><button class="btn sm plain" data-action="barber-back" data-id="${b.id}">Réactiver</button></div>`).join('')}
        </details>` : ''}
    </div>

    ${catalogEditor('prestations', 'Carte des prestations')}
    ${catalogEditor('produits', 'Produits en vente')}
    <p class="group-foot">Les tickets déjà encaissés gardent le prix du moment.</p>

    <h3 class="group-title">Sauvegarde automatique</h3>
    <div class="group">
      ${DEMO ? '<p class="row muted">Désactivée en mode démo.</p>' : `
        <div class="row"><span class="row-label">État</span><span class="sync-state ${sync.status}" id="sync-state">${esc(syncLabel())}</span><button class="btn sm" data-action="sync-now">Sauvegarder maintenant</button></div>
        <div class="row"><span class="row-label">Code de récupération</span><span class="key-mask">${ui.showKey ? cloud.formatKey(S.meta.salonKey) : `••••-••••-${S.meta.salonKey.slice(8)}`}</span><button class="btn sm plain" data-action="toggle-key">${ui.showKey ? 'Masquer' : 'Afficher'}</button></div>`}
    </div>
    <p class="group-foot">Chaque encaissement part en sécurité en ligne dans les minutes qui suivent, même si internet revient plus tard. Si la tablette est perdue ou cassée, ce code permet de tout récupérer sur une nouvelle. Garde-le pour toi.</p>

    <h3 class="group-title">Fichiers</h3>
    <div class="group${backupLate() ? ' warn' : ''}">
      <div class="data-grid">
        <div class="data-box">
          <h4>Export Excel / Google Sheets</h4>
          <div class="addrow">
            <select class="input grow" id="exp-month" aria-label="Mois à exporter">${months.map((k) => `<option value="${k}">${esc(monthName(k))}</option>`).join('')}</select>
            <button class="btn sm" data-action="export" data-kind="month">Exporter le mois</button>
          </div>
          <div class="addrow">
            <select class="input grow" id="exp-year" aria-label="Année à exporter">${years.map((y) => `<option value="${y}">${y}</option>`).join('')}</select>
            <button class="btn sm" data-action="export" data-kind="year">Exporter l'année</button>
          </div>
        </div>
        <div class="data-box">
          <h4>Copie en fichier</h4>
          <p class="muted">Dernière copie : ${S.meta.lastBackupAt ? `${fmtDate(S.meta.lastBackupAt)} à ${fmtTime(S.meta.lastBackupAt)}` : 'jamais'}</p>
          <div class="addrow">
            <button class="btn primary sm" data-action="backup">Créer une copie</button>
            <label class="btn sm file">Restaurer<input type="file" accept=".json,application/json" data-change="restore"></label>
          </div>
        </div>
      </div>
    </div>
    <p class="group-foot">Export pour Excel ou Google Sheets, et copie de secours en fichier si tu veux en garder une toi-même (mail, WhatsApp, Drive).</p>

    <h3 class="group-title">Installer sur la tablette</h3>
    <div class="group">
      <p class="row">iPad : bouton Partager, puis « Sur l'écran d'accueil ». Android : menu ⋮, puis « Installer l'application ». La caisse s'ouvre alors en plein écran, même sans internet.</p>
    </div>
    ${DEMO ? `
      <h3 class="group-title">Démo</h3>
      <div class="group">
        <div class="row"><span class="row-label">Données fictives, rangées à part des vraies données du salon.</span><button class="btn sm" data-action="demo-reset">Recharger la démo</button></div>
      </div>` : ''}`;
}

// ——— Premier lancement ———

function setupView() {
  const d = ui.setup;
  const head = `
    <div class="setup-brand">
      ${HEXROW}
      ${LOGO}
      <h1 class="wordmark xl">Kartel BBS</h1>
      <p class="kicker">Caisse du comptoir</p>
    </div>`;
  if (d.recover) return recoverView(head);
  if (d.step === 1) {
    return `
      <div class="setup">
        ${head}
        <form class="setup-card glass" data-submit="setup-add">
          <p class="step-n">Étape 1 sur 2</p>
          <h2 class="setup-title">Ton salon</h2>
          <label class="field"><span>Nom du salon</span><input class="input" id="setup-salon" value="${esc(d.name)}" placeholder="Ex. Kartel BBS Centre" maxlength="40" autocomplete="off"></label>
          <div class="field">
            <span>Ton équipe</span>
            <ul class="chips">${d.barbers.length
              ? d.barbers.map((n, i) => `<li>${esc(n)}<button type="button" class="chip-x" data-action="setup-remove" data-i="${i}" aria-label="Retirer ${esc(n)}">${ic('x')}</button></li>`).join('')
              : '<li class="chips-empty">Ajoute tes barbers un par un.</li>'}</ul>
            <div class="addrow"><input class="input grow" id="setup-barber" name="barber" placeholder="Nom d'un barber" maxlength="24" autocomplete="off"><button class="btn">${ic('plus')} Ajouter</button></div>
          </div>
          <button type="button" class="btn primary lg block" data-action="setup-next">Continuer</button>
        </form>
        <div class="setup-links">
          <button type="button" class="btn plain" data-action="recover-open">Récupérer un salon avec son code</button>
          <label class="btn plain file">Restaurer un fichier de sauvegarde<input type="file" accept=".json,application/json" data-change="restore"></label>
        </div>
      </div>`;
  }
  return `
    <div class="setup">
      ${head}
      <div class="setup-card wide glass">
        <p class="step-n">Étape 2 sur 2</p>
        <h2 class="setup-title">Ta carte des prix</h2>
        <p class="muted">Tes barbers toucheront ces boutons pour encaisser. Tu pourras tout changer plus tard dans Réglages.</p>
        ${d.chosen ? `
          ${catalogEditor('prestations', 'Prestations')}
          ${catalogEditor('produits', 'Produits en vente')}
          <div class="setup-actions">
            <button type="button" class="btn plain" data-action="setup-back">Retour</button>
            <button type="button" class="btn primary lg" data-action="setup-done">Ouvrir la caisse</button>
          </div>` : `
          <div class="choice">
            <button type="button" class="choice-btn" data-action="setup-carte" data-carte="type">
              <strong>Partir de la carte type</strong>
              <span>${DEFAULT_CATALOG.prestations.length} prestations et ${DEFAULT_CATALOG.produits.length} produits déjà remplis. Tu ajustes tes prix et tu retires ce que tu ne fais pas.</span>
            </button>
            <button type="button" class="choice-btn" data-action="setup-carte" data-carte="vide">
              <strong>Commencer avec une carte vide</strong>
              <span>Tu tapes toi-même chaque prestation, chaque produit et son prix.</span>
            </button>
          </div>
          <div class="setup-actions"><button type="button" class="btn plain" data-action="setup-back">Retour</button></div>`}
      </div>
    </div>`;
}

function recoverView(head) {
  return `
    <div class="setup">
      ${head}
      <form class="setup-card glass" data-submit="recover">
        <p class="step-n">Récupération</p>
        <h2 class="setup-title">Récupérer un salon</h2>
        <p class="muted">Tape le code de récupération de l'ancienne tablette (Réglages, Sauvegarde automatique).</p>
        <label class="field"><span>Code de récupération</span><input class="input code-in" name="code" placeholder="XXXX-XXXX-XXXX" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
        <div class="setup-actions">
          <button type="button" class="btn plain" data-action="recover-cancel">Retour</button>
          <button class="btn primary lg">Récupérer</button>
        </div>
      </form>
    </div>`;
}

function setupNext() {
  const name = document.getElementById('setup-salon').value.trim();
  const pending = document.getElementById('setup-barber').value.trim();
  if (pending) ui.setup.barbers.push(pending);
  ui.setup.name = name;
  if (!name) { render(); toast('Donne un nom au salon'); document.getElementById('setup-salon').focus(); return; }
  if (!ui.setup.barbers.length) { render(); toast('Ajoute au moins un barber'); document.getElementById('setup-barber').focus(); return; }
  S.salon.name = name;
  S.barbers = ui.setup.barbers.map((n) => ({ id: uid(), name: n, active: true }));
  S.meta.setupDone = false;
  ui.setup = { step: 2, chosen: false };
  save();
  window.scrollTo(0, 0);
}

function setupDone() {
  flushAddRows();
  if (!S.catalog.prestations.length) {
    render();
    toast('Ajoute au moins une prestation');
    app.querySelector('[data-submit="cat-add"][data-list="prestations"] [name="name"]')?.focus();
    return;
  }
  S.meta.setupDone = true;
  ui.setup = null;
  ui.enter.view = true;
  save();
  window.scrollTo(0, 0);
  toast('Caisse prête');
  if (!DEMO) {
    infoBox('Voici ton code de récupération. Prends-le en photo : si la tablette est perdue ou cassée, il permet de tout récupérer sur une nouvelle. Tu le retrouves aussi dans Réglages.', "C'est noté", cloud.formatKey(S.meta.salonKey));
  }
}

const setupFor = (s) => (!s.salon.name ? { step: 1, name: '', barbers: [] } : s.meta.setupDone === false ? { step: 2, chosen: true } : null);

// ——— Export, sauvegarde, restauration ———

async function share(filename, text, type) {
  const file = new File([text], filename, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

function exportPeriod(kind) {
  const value = document.getElementById(kind === 'month' ? 'exp-month' : 'exp-year')?.value;
  if (!value) return;
  const anchor = kind === 'month' ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1).getTime() : new Date(+value, 0, 1).getTime();
  const range = periodRange(kind, anchor);
  if (!S.tickets.some((t) => t.ts >= range.start && t.ts < range.end)) { toast('Aucun encaissement sur cette période'); return; }
  share(`kartel-bbs-${slug(S.salon.name)}-${value}.csv`, toCSV(S, range), 'text/csv');
}

async function backup() {
  const now = new Date();
  const name = `kartel-bbs-sauvegarde-${slug(S.salon.name)}-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.json`;
  if (!(await share(name, JSON.stringify(S), 'application/json'))) return;
  S.meta.lastBackupAt = now.getTime();
  save();
  toast('Copie créée');
}

async function restore(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Fichier illisible');
    return;
  }
  if (!validateState(data)) { toast("Ce fichier n'est pas une sauvegarde Kartel BBS"); return; }
  confirmBox(
    `Remplacer toutes les données de cette tablette par la sauvegarde « ${data.salon.name || 'sans nom'} » (${plural(data.tickets.length, 'ticket', 'tickets')}) ?`,
    'Remplacer',
    () => {
      S = data;
      ensureCloudIds();
      sync.claim = true;
      sync.status = 'idle';
      ui.setup = setupFor(S);
      persist();
      toast('Sauvegarde restaurée');
    },
  );
}

// ——— Confirmations et notifications ———

function confirmBox(text, ok, onOk) {
  ui.modal = { text, ok, onOk };
  ui.enter.modal = true;
  render();
}

function infoBox(text, ok, code = '') {
  ui.modal = { text, ok, onOk: () => {}, info: true, code };
  ui.enter.modal = true;
  render();
}

function modalView() {
  const anim = ui.enter.modal ? ' enter' : '';
  return `
    <div class="modal-back${anim}">
      <div class="modal${anim}" role="alertdialog" aria-modal="true" aria-labelledby="modal-text">
        <p id="modal-text" class="m-text">${esc(ui.modal.text)}</p>
        ${ui.modal.code ? `<p class="m-code">${esc(ui.modal.code)}</p>` : ''}
        <div class="m-actions${ui.modal.info ? ' single' : ''}">
          ${ui.modal.info ? '' : '<button class="btn" data-action="modal-cancel">Annuler</button>'}
          <button class="btn primary" data-action="modal-ok">${esc(ui.modal.ok)}</button>
        </div>
      </div>
    </div>`;
}

let toastTimer = 0;
let undoFn = null;
function toast(msg, undo = null) {
  undoFn = undo;
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="t-undo">Annuler</button>' : ''}`;
  toastEl.classList.toggle('has-undo', Boolean(undo));
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    undoFn = null;
  }, undo ? 10000 : 2800);
}

toastEl.addEventListener('click', (e) => {
  if (!e.target.closest('.t-undo') || !undoFn) return;
  const fn = undoFn;
  undoFn = null;
  toastEl.classList.remove('show');
  fn();
});

// ——— Sauvegarde automatique en ligne ———

const SYNC_EVERY = 3 * 60000; // au plus une copie toutes les 3 minutes pendant l'activité
const sync = { status: 'idle', error: '', at: 0, dirty: false, busy: false, claim: false, timer: 0 };

// Identifiant propre à cet appareil (jamais inclus dans les sauvegardes).
function deviceId() {
  try {
    let id = localStorage.getItem('kartel-bbs-device');
    if (!id) {
      id = cloud.newDeviceId();
      localStorage.setItem('kartel-bbs-device', id);
    }
    return id;
  } catch {
    deviceId.mem ??= cloud.newDeviceId();
    return deviceId.mem;
  }
}

function ensureCloudIds() {
  if (!S.meta.salonKey) S.meta.salonKey = cloud.newKey();
}

function since(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  return `le ${fmtDate(ts)} à ${fmtTime(ts)}`;
}

function syncLabel() {
  switch (sync.status) {
    case 'sending': return 'Envoi en cours…';
    case 'ok': return `À jour, dernière copie ${since(sync.at)}`;
    case 'offline': return "En attente d'internet, rien n'est perdu";
    case 'error': return 'Échec, nouvel essai dans une minute';
    case 'owner': return 'Arrêtée : ce code a été repris sur un autre appareil';
    default: return S.meta.cloudAt ? `Dernière copie ${since(S.meta.cloudAt)}` : 'Première copie dans quelques secondes';
  }
}

function setSync(status, error = '') {
  sync.status = status;
  sync.error = error;
  const el = document.getElementById('sync-state');
  if (el) {
    el.textContent = syncLabel();
    el.className = `sync-state ${status}`;
  }
}

function scheduleSync(delay) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
}

function markDirty() {
  if (DEMO || !S?.meta?.salonKey || sync.status === 'owner') return;
  sync.dirty = true;
  if (!sync.busy) scheduleSync(Math.max(5000, sync.at + SYNC_EVERY - Date.now()));
}

async function runSync() {
  if (DEMO || sync.busy || !sync.dirty || ui.setup || !S.meta.salonKey) return;
  if (!navigator.onLine) { setSync('offline'); return; }
  sync.busy = true;
  sync.dirty = false;
  setSync('sending');
  try {
    await cloud.upload(S, deviceId(), { claim: sync.claim });
    sync.claim = false;
    sync.at = Date.now();
    S.meta.cloudAt = sync.at;
    store.save(S);
    setSync('ok');
  } catch (err) {
    sync.dirty = true;
    if (err.status === 409) {
      setSync('owner');
    } else {
      setSync(navigator.onLine ? 'error' : 'offline', err.message);
      if (navigator.onLine) scheduleSync(60000);
    }
  } finally {
    sync.busy = false;
    if (sync.dirty && sync.status === 'ok') scheduleSync(Math.max(5000, sync.at + SYNC_EVERY - Date.now()));
  }
}

window.addEventListener('online', () => { if (sync.dirty && sync.status !== 'owner') scheduleSync(2000); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && sync.dirty) runSync(); });

// ——— Événements ———

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || ui.closing) return;
  const label = document.getElementById('other-label');
  if (label && ui.other) ui.other.label = label.value;
  const { id } = el.dataset;
  switch (el.dataset.action) {
    case 'nav':
      ui.view = el.dataset.view;
      ui.enter.view = true;
      render();
      window.scrollTo(0, 0);
      break;
    case 'sale':
      ui.sale = { barberId: id, tab: 'presta', items: [] };
      ui.enter.sale = true;
      render();
      break;
    case 'sale-close':
      if (ui.sale?.items.length) confirmBox('Fermer sans enregistrer ce ticket ?', 'Fermer', () => { ui.sale = null; });
      else closeSale();
      break;
    case 'sale-tab':
      ui.sale.tab = el.dataset.tab;
      render();
      break;
    case 'add': {
      const list = ui.sale.tab === 'presta' ? S.catalog.prestations : S.catalog.produits;
      const p = list.find((x) => x.id === id);
      if (p) addItem(ui.sale.tab, p);
      render();
      break;
    }
    case 'qty': {
      const i = Number(el.dataset.i);
      const it = ui.sale.items[i];
      if (!it) break;
      it.qty += Number(el.dataset.d);
      if (it.qty <= 0) ui.sale.items.splice(i, 1);
      render();
      break;
    }
    case 'other-open':
      ui.other = { digits: '', kind: ui.sale.tab, label: '' };
      ui.enter.other = true;
      render();
      break;
    case 'other-kind':
      ui.other.kind = el.dataset.kind;
      render();
      break;
    case 'key':
      pressKey(el.dataset.k);
      render();
      break;
    case 'other-cancel':
      ui.other = null;
      render();
      break;
    case 'other-ok': {
      const price = parsePrice(ui.other.digits);
      if (!price) break;
      const name = ui.other.label.trim() || (ui.other.kind === 'presta' ? 'Prestation (montant libre)' : 'Produit (montant libre)');
      addItem(ui.other.kind, { name, price });
      ui.other = null;
      render();
      break;
    }
    case 'pay':
      pay(el.dataset.pay);
      break;
    case 'punch':
      punch(id);
      break;
    case 'period':
      ui[el.dataset.scope].kind = el.dataset.kind;
      render();
      break;
    case 'shift': {
      const p = ui[el.dataset.scope];
      p.anchor = shiftPeriod(p.kind, p.anchor, Number(el.dataset.d));
      render();
      break;
    }
    case 'today':
      ui[el.dataset.scope].anchor = Date.now();
      render();
      break;
    case 'metric':
      ui.rank.metric = el.dataset.m;
      render();
      break;
    case 'toggle-pay': {
      const t = S.tickets.find((x) => x.id === id);
      if (!t) break;
      t.pay = t.pay === 'cb' ? 'especes' : 'cb';
      save();
      toast(`Paiement passé en ${PAY_LABEL[t.pay]}`);
      break;
    }
    case 'del-ticket': {
      const t = S.tickets.find((x) => x.id === id);
      if (!t) break;
      confirmBox(`Supprimer le ticket de ${eur(ticketTotal(t))} (${barberName(t.barberId)}, ${fmtTime(t.ts)}) ?`, 'Supprimer', () => {
        S.tickets = S.tickets.filter((x) => x.id !== id);
        persist();
      });
      break;
    }
    case 'del-shift':
      confirmBox('Supprimer ce pointage ?', 'Supprimer', () => {
        S.shifts = S.shifts.filter((x) => x.id !== id);
        persist();
      });
      break;
    case 'barber-leave': {
      const b = S.barbers.find((x) => x.id === id);
      if (!b) break;
      confirmBox(`${b.name} a quitté le salon ? Ses chiffres restent dans l'historique.`, 'Confirmer', () => {
        b.active = false;
        const sh = openShift(b.id);
        if (sh) sh.end = Date.now();
        persist();
      });
      break;
    }
    case 'barber-back': {
      const b = S.barbers.find((x) => x.id === id);
      if (!b) break;
      b.active = true;
      save();
      toast(`${b.name} est de retour dans l'équipe`);
      break;
    }
    case 'cat-del': {
      const { list } = el.dataset;
      const p = S.catalog[list].find((x) => x.id === id);
      if (!p) break;
      confirmBox(`Retirer « ${p.name} » de la carte ? Les tickets passés ne changent pas.`, 'Retirer', () => {
        S.catalog[list] = S.catalog[list].filter((x) => x.id !== id);
        persist();
      });
      break;
    }
    case 'export':
      exportPeriod(el.dataset.kind);
      break;
    case 'backup':
      backup();
      break;
    case 'demo-reset':
      confirmBox('Recharger les données de démo ?', 'Recharger', () => {
        S = demoState();
        persist();
      });
      break;
    case 'setup-remove':
      ui.setup.name = document.getElementById('setup-salon').value;
      ui.setup.barbers.splice(Number(el.dataset.i), 1);
      render();
      break;
    case 'setup-next':
      setupNext();
      break;
    case 'setup-back':
      ui.setup = { step: 1, name: S.salon.name, barbers: S.barbers.map((b) => b.name) };
      render();
      window.scrollTo(0, 0);
      break;
    case 'setup-carte':
      S.catalog = el.dataset.carte === 'vide' ? { prestations: [], produits: [] } : JSON.parse(JSON.stringify(DEFAULT_CATALOG));
      ui.setup.chosen = true;
      save();
      if (el.dataset.carte === 'vide') app.querySelector('[data-submit="cat-add"][data-list="prestations"] [name="name"]')?.focus();
      break;
    case 'setup-done':
      setupDone();
      break;
    case 'recover-open':
      ui.setup.name = document.getElementById('setup-salon')?.value ?? ui.setup.name;
      ui.setup.recover = true;
      render();
      break;
    case 'recover-cancel':
      ui.setup.recover = false;
      render();
      break;
    case 'toggle-key':
      ui.showKey = !ui.showKey;
      render();
      break;
    case 'sync-now':
      if (sync.status === 'owner') {
        sync.claim = true;
        sync.status = 'idle';
      }
      sync.dirty = true;
      runSync();
      break;
    case 'modal-ok': {
      const fn = ui.modal.onOk;
      ui.modal = null;
      fn();
      render();
      break;
    }
    case 'modal-cancel':
      ui.modal = null;
      render();
      break;
    default:
      break;
  }
});

// Les champs texte enregistrent sans re-rendu, pour ne jamais voler le focus du champ suivant.
app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const { id } = el.dataset;
  switch (el.dataset.change) {
    case 'salon-name': {
      const v = el.value.trim();
      if (!v) { el.value = S.salon.name; break; }
      S.salon.name = v;
      save(false);
      document.querySelectorAll('.salon-name').forEach((n) => { n.textContent = v; });
      break;
    }
    case 'barber-name': {
      const b = S.barbers.find((x) => x.id === id);
      const v = el.value.trim();
      if (!b) break;
      if (!v) { el.value = b.name; break; }
      b.name = v;
      save(false);
      break;
    }
    case 'cat': {
      const p = S.catalog[el.dataset.list].find((x) => x.id === id);
      if (!p) break;
      const { field } = el.dataset;
      if (field === 'price') {
        const v = parsePrice(el.value);
        if (v === null) { el.value = priceText(p.price); toast('Prix invalide'); break; }
        p.price = v;
        el.value = priceText(v);
        save(false);
      } else if (field === 'name') {
        const v = el.value.trim();
        if (!v) { el.value = p.name; break; }
        p.name = v;
        save(false);
      } else {
        p.group = el.value;
        save();
      }
      break;
    }
    case 'shift-time':
      setShiftTime(id, el.dataset.field, el.value);
      break;
    case 'restore':
      restore(el.files[0]);
      el.value = '';
      break;
    default:
      break;
  }
});

app.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-submit]');
  if (!form) return;
  e.preventDefault();
  const f = new FormData(form);
  switch (form.dataset.submit) {
    case 'setup-add': {
      ui.setup.name = document.getElementById('setup-salon').value;
      const n = String(f.get('barber') || '').trim();
      if (n) ui.setup.barbers.push(n);
      render();
      document.getElementById('setup-barber').focus();
      break;
    }
    case 'recover': {
      const key = cloud.normalizeKey(f.get('code'));
      if (key.length !== 12) { toast('Le code fait 12 caractères'); break; }
      const btn = form.querySelector('.btn.primary');
      btn.disabled = true;
      btn.textContent = 'Recherche…';
      cloud.download(key, deviceId())
        .then((data) => {
          if (!validateState(data.state)) throw new Error('state');
          const at = Date.parse(data.at);
          confirmBox(`Récupérer « ${data.salon || 'Salon'} » (${plural(data.tickets, 'ticket', 'tickets')}, dernière copie le ${fmtDate(at)} à ${fmtTime(at)}) ? Cette tablette reprend la sauvegarde automatique de ce salon.`, 'Récupérer', () => {
            S = data.state;
            S.meta.salonKey = key;
            S.meta.setupDone = true;
            sync.claim = true;
            sync.status = 'idle';
            ui.setup = setupFor(S);
            persist();
            toast('Salon récupéré');
          });
        })
        .catch((err) => {
          btn.disabled = false;
          btn.textContent = 'Récupérer';
          toast(err.status === 404 ? 'Aucune sauvegarde pour ce code' : 'Sauvegarde injoignable, vérifie internet');
        });
      break;
    }
    case 'barber-add': {
      const name = String(f.get('name') || '').trim();
      if (!name) break;
      S.barbers.push({ id: uid(), name, active: true });
      save();
      toast(`${name} a rejoint l'équipe`);
      break;
    }
    case 'cat-add': {
      const { list } = form.dataset;
      const name = String(f.get('name') || '').trim();
      const price = parsePrice(f.get('price'));
      if (!name || price === null) { toast('Nom et prix obligatoires'); break; }
      addCatalogItem(list, name, price, f.get('group'));
      save();
      toast(`${name} ajouté à la carte`);
      app.querySelector(`[data-submit="cat-add"][data-list="${list}"] [name="name"]`)?.focus();
      break;
    }
    case 'shift-add': {
      const day = new Date(ui.hist.anchor);
      const at = (v) => {
        const [h, m] = String(v).split(':').map(Number);
        const d = new Date(day);
        d.setHours(h, m, 0, 0);
        return d.getTime();
      };
      const start = at(f.get('start'));
      const end = f.get('end') ? at(f.get('end')) : null;
      if (end !== null && end <= start) { toast("Le départ doit être après l'arrivée"); break; }
      S.shifts.push({ id: uid(), barberId: String(f.get('barber')), start, end });
      save();
      toast('Pointage ajouté');
      break;
    }
    default:
      break;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || ui.closing) return;
  if (ui.modal) { ui.modal = null; render(); return; }
  if (ui.other) { ui.other = null; render(); return; }
  if (ui.sale && !ui.sale.items.length) closeSale();
});

// L'horloge avance ; à minuit, le Comptoir repart à zéro tout seul.
let dayStart = periodRange('day', Date.now()).start;
setInterval(() => {
  const now = Date.now();
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = fmtTime(now);
  const today = periodRange('day', now).start;
  if (today !== dayStart && S && !ui.sale && !ui.other && !ui.modal && !ui.setup) {
    dayStart = today;
    render();
  }
}, 20000);

// ——— Démarrage ———

async function init() {
  store.useKey(DEMO ? 'demo' : 'main');
  let data = null;
  try {
    data = await store.load();
  } catch {
    data = null;
  }
  if (DEMO && (!validateState(data) || data.meta.createdAt < periodRange('day', Date.now()).start)) data = demoState();
  if (data && !validateState(data)) {
    try {
      localStorage.setItem(`kartel-bbs-illisible-${Date.now()}`, JSON.stringify(data));
    } catch {
      // Stockage indisponible : on repart d'une caisse vide sans détruire l'ancienne donnée ici.
    }
    data = null;
  }
  S = data || defaultState();
  if (!DEMO) ensureCloudIds();
  persist();
  ui.setup = setupFor(S);
  ui.enter.view = true;
  render();
  store.persist();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
