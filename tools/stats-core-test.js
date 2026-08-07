#!/usr/bin/env node
/* Test de non-régression de stats-core.js (moteur PUR partagé : page publique + launcher + régie).
   Verrouille : confidentialité (joueurs privés exclus), formats, agrégats, champions,
   et le décodage v5 (trio mergeUp / deriveIntervalsDay / normalizeStatsData) qui sert les 3 consommateurs.
   Lancé en CI (valider.yml) et à la main : node tools/stats-core-test.js */
'use strict';
require('../stats-core.js'); // définit globalThis.StatsCore (+ module.exports)
const SC = globalThis.StatsCore;

let fails = 0;
function check(name, cond) { if (cond) { console.log('  PASS ' + name); } else { fails++; console.log('  FAIL ' + name); } }
function eq(name, got, want) { check(name + ' (=' + JSON.stringify(want) + ', got ' + JSON.stringify(got) + ')', JSON.stringify(got) === JSON.stringify(want)); }

// Jeu de données v5 : Alpha (public) + Secret (privé /meyprivacy)
const data = {
  version: 5,
  seen: {
    Alpha: { uuid: 'ua', minutes: 120, first: '2026-06-01T10:00:00Z', last: '2026-06-30T20:00:00Z',
             mc: { mobKills: 500, diamonds: 50, distTotM: 3000, fishCaught: 10, adv: 5 } },
    Secret: { uuid: 'us', minutes: 999, mc: { mobKills: 99999, diamonds: 999 } },
  },
  priv: { us: true },
  days: { '2026-06-30': { ses: { Alpha: [[0, 3600]] } } },
};

console.log('stats-core.js — non-régression');
check('SC chargé', !!SC && typeof SC.pubKeys === 'function');

// Confidentialité : Secret exclu partout
eq('isPrivate(us)', SC.isPrivate(data, 'us'), true);
eq('isPrivate(ua)', SC.isPrivate(data, 'ua'), false);
eq('pubKeys exclut le privé', SC.pubKeys(data), ['Alpha']);
eq('players : 1 public trié', SC.players(data).map((p) => p.name), ['Alpha']);

// Formats
eq('fmtPlayTime 120', SC.fmtPlayTime(120), '2 h 00');
eq('fmtPlayTime 45', SC.fmtPlayTime(45), '45 min');
eq('fmtDist 3000', SC.fmtDist(3000), '3.0 km');
eq('fmtDist 500', SC.fmtDist(500), '500 m');
// #31 : nombres en français (séparateur de milliers). NB : toLocaleString('fr-FR') utilise l'espace
// insécable U+202F comme séparateur — on compare donc au rendu réel de l'environnement, pas à un ' '.
eq('fmtNum 12345', SC.fmtNum(12345), (12345).toLocaleString('fr-FR'));
eq('fmtNum 0', SC.fmtNum(0), '0');
eq('fmtNum arrondit', SC.fmtNum(3.7), '4');
eq('fmtNum non-nombre → 0', SC.fmtNum(undefined), '0');
eq('fmtNum sépare bien les milliers (longueur > 4)', SC.fmtNum(12345).length > 5, true);
eq('escapeHtml échappe < & "', SC.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');

// survieMoyenne : temps de jeu ÷ (morts + 1) — ne s'efface jamais (contrairement à noDeathMin)
eq('survieMoyenne 120 min / 0 mort', SC.survieMoyenne({ playMin: 120, deaths: 0 }), 120);
eq('survieMoyenne 120 min / 3 morts', SC.survieMoyenne({ playMin: 120, deaths: 3 }), 30);
eq('survieMoyenne sans deaths → tout le temps', SC.survieMoyenne({ playMin: 60 }), 60);
eq('survieMoyenne 0 min → null', SC.survieMoyenne({ playMin: 0, deaths: 5 }), null);
eq('survieMoyenne mc absent → null', SC.survieMoyenne(null), null);
eq('survieMoyenne deaths négatif → ignoré (pas de division bizarre)', SC.survieMoyenne({ playMin: 60, deaths: -2 }), 60);
// rankOf avec une valeur CALCULÉE (4e argument) : classe sur la survie moyenne, pas sur une clé mc
{
  const d = { seen: {
    Solide: { uuid: 'a', mc: { playMin: 300, deaths: 1 } },   // 150
    Fragile: { uuid: 'b', mc: { playMin: 300, deaths: 29 } }, // 10
    Neuf: { uuid: 'c', mc: { playMin: 0, deaths: 0 } },       // null → exclu
  }, priv: {} };
  eq('rankOf calculé : le plus résistant est n°1', SC.rankOf(d, 'survieMoy', 'Solide', SC.survieMoyenne), { rank: 1, total: 2, value: 150 });
  eq('rankOf calculé : le fragile est n°2', SC.rankOf(d, 'survieMoy', 'Fragile', SC.survieMoyenne), { rank: 2, total: 2, value: 10 });
  eq('rankOf calculé : joueur sans temps de jeu exclu', SC.rankOf(d, 'survieMoy', 'Neuf', SC.survieMoyenne), null);
  eq('rankOf SANS calc inchangé (non-régression)', SC.rankOf(d, 'playMin', 'Solide'), { rank: 1, total: 2, value: 300 });
}

// Présence / rangs
eq('daysPresent Alpha', SC.daysPresent(data, 'Alpha'), 1);
eq('playtimeRank Alpha', SC.playtimeRank(data, 'Alpha'), { rank: 1, total: 1 });
eq('rankOf mobKills Alpha', SC.rankOf(data, 'mobKills', 'Alpha'), { rank: 1, total: 1, value: 500 });

// Agrégat collectif : le privé ne compte PAS
const c = SC.collective(data);
eq('collective players', c.players, 1);
eq('collective minutes', c.minutes, 120);
eq('collective mobs', c.mobs, 500);
eq('collective diamonds', c.diamonds, 50);

// Champions : basés sur les publics uniquement
const champ = SC.champions(data);
check('champions est une liste non vide', Array.isArray(champ) && champ.length > 0);
check('champion assidu = Alpha (pas Secret)', champ.some((x) => x.label === 'Le plus assidu' && x.name === 'Alpha'));
check('aucun champion = Secret', !champ.some((x) => x.name === 'Secret'));

// milestones : renvoie une liste (ici vide car seuils non atteints)
check('milestones est une liste', Array.isArray(SC.milestones(c)));
eq('milestones 4 paliers', SC.milestones({ minutes: 60 * 100, mobs: 5000, diamonds: 500, distM: 100000 }).length, 4);
eq('milestones aucun si zéro', SC.milestones({ minutes: 0, mobs: 0, diamonds: 0, distM: 0 }).length, 0);

// ── Décodage v5 : mergeUp (SOURCE UNIQUE launcher + régie + page) ──
eq('mergeUp fusionne micro-coupure (60s <= 300)', SC.mergeUp([[0, 600], [660, 1200]], 300), [[0, 1200]]);
eq('mergeUp garde un vrai trou (400s > 300)', SC.mergeUp([[0, 600], [1000, 1200]], 300), [[0, 600], [1000, 1200]]);
eq('mergeUp ignore intervalles vides/inversés', SC.mergeUp([[5, 5], [10, 8], [20, 30]], 300), [[20, 30]]);
eq('UP_MERGE_GAP_SEC = 300', SC.UP_MERGE_GAP_SEC, 300);

// ── deriveIntervalsDay : superset { slots, presence, up, ses, cr } ──
const day = SC.deriveIntervalsDay({ up: [[0, 600], [660, 1200]], ses: { Bob: [[60, 180]] }, cr: [[1, 2]] });
eq('derive: up fusionné', day.up, [[0, 1200]]);
check('derive: slots serveur en ligne = 0', day.slots[0] === 0 && day.slots[19] === 0);
check('derive: slot hors up = null', day.slots[20] === null);
check('derive: présence Bob (+1)', day.slots[1] === 1 && day.slots[2] === 1);
eq('derive: presence Bob = [1,2]', day.presence.Bob, [1, 2]);
check('derive: superset ses + cr conservés', !!day.ses && Array.isArray(day.cr) && day.cr.length === 1);

// ── normalizeStatsData : v5 (up/ses) ET compact legacy (s/p) ──
const nv5 = SC.normalizeStatsData({ days: { '2026-07-01': { up: [[0, 120]], ses: { Bob: [[0, 60]] } } } });
check('normalize v5 : slots dérivés', nv5.days['2026-07-01'].slots[0] === 1);
const nleg = SC.normalizeStatsData({ days: { '2026-06-01': { s: { '10': 2, '11': 1 }, p: { Zeta: [[10, 11]] } } } });
eq('normalize legacy : slots depuis d.s', nleg.days['2026-06-01'].slots[10], 2);
eq('normalize legacy : presence depuis d.p', nleg.days['2026-06-01'].presence.Zeta, [10, 11]);

// Sécurité : clé de date malformée ignorée (anti-injection — les clés sont réinjectées en HTML par les consommateurs)
const nxss = SC.normalizeStatsData({ days: { '2026-07-01': { up: [[0, 60]] }, 'a"><img src=x onerror=alert(1)>': { up: [[0, 60]] } } });
const nxk = Object.keys(nxss.days);
check('normalize : clé de date valide conservée', nxk.includes('2026-07-01'));
check('normalize : clé de date malformée rejetée', nxk.length === 1);

if (fails === 0) { console.log('\n✔ stats-core : tous les tests passent.'); process.exit(0); }
console.error('\n✖ stats-core : ' + fails + ' test(s) en échec.'); process.exit(1);
