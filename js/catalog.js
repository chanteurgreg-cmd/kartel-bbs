// Carte par défaut (reprise de la démo Kartel BBS). Adam la modifie librement dans Réglages.
export const GROUPS = ['Coupes & barbe', 'Extras', 'Tresses & locks', 'Couleur & lissage', 'Autres'];

const P = (id, name, price, group) => ({ id, name, price, group });

export const DEFAULT_CATALOG = {
  prestations: [
    P('p1', 'Coupe simple', 20, 'Coupes & barbe'),
    P('p2', 'Coupe + barbe', 25, 'Coupes & barbe'),
    P('p3', 'Coupe étudiant', 15, 'Coupes & barbe'),
    P('p4', 'Coupe enfant (-10 ans)', 15, 'Coupes & barbe'),
    P('p5', 'Contour', 10, 'Coupes & barbe'),
    P('p6', 'Barbe', 10, 'Coupes & barbe'),
    P('p7', 'Contour + barbe', 15, 'Coupes & barbe'),
    P('p8', 'Serviette chaude', 5, 'Extras'),
    P('p9', 'Masque noir', 5, 'Extras'),
    P('p10', 'Soin visage', 10, 'Extras'),
    P('p11', 'Design / dessin', 5, 'Extras'),
    P('p12', 'Tresse cheveux court', 25, 'Tresses & locks'),
    P('p13', 'Tresse cheveux long', 35, 'Tresses & locks'),
    P('p14', 'Tresse design court', 30, 'Tresses & locks'),
    P('p15', 'Tresse design long', 40, 'Tresses & locks'),
    P('p16', 'Vanille cheveux court', 45, 'Tresses & locks'),
    P('p17', 'Vanille cheveux long', 60, 'Tresses & locks'),
    P('p18', 'Tourne locks + vanille', 70, 'Tresses & locks'),
    P('p19', 'Tourne locks + coiffure', 80, 'Tresses & locks'),
    P('p20', 'Décoloration (à partir de)', 18, 'Couleur & lissage'),
    P('p21', 'Coloration cheveux court', 30, 'Couleur & lissage'),
    P('p22', 'Coloration cheveux long', 60, 'Couleur & lissage'),
    P('p23', 'Défrisage cheveux court', 30, 'Couleur & lissage'),
    P('p24', 'Défrisage cheveux long', 60, 'Couleur & lissage'),
    P('p25', 'Mèches cheveux court', 50, 'Couleur & lissage'),
    P('p26', 'Mèches cheveux long', 70, 'Couleur & lissage'),
    P('p27', 'Lissage brésilien court', 95, 'Couleur & lissage'),
    P('p28', 'Lissage brésilien long', 150, 'Couleur & lissage'),
  ],
  produits: [
    { id: 'r1', name: 'Cire', price: 12 },
    { id: 'r2', name: 'Poudre coiffante', price: 12 },
    { id: 'r3', name: 'Huile à barbe', price: 15 },
    { id: 'r4', name: 'Shampoing', price: 10 },
    { id: 'r5', name: 'Spray', price: 10 },
  ],
};

export function defaultState(now = Date.now()) {
  return {
    v: 1,
    salon: { name: '' },
    barbers: [],
    catalog: JSON.parse(JSON.stringify(DEFAULT_CATALOG)),
    tickets: [],
    shifts: [],
    meta: { createdAt: now, lastBackupAt: null, setupDone: false },
  };
}
