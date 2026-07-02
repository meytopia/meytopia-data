#!/usr/bin/env node
/* Test de non-régression de stats-core.js (moteur PUR partagé par la page publique).
   Verrouille : confidentialité (joueurs privés exclus), formats, agrégats, champions.
   Lancé en CI (valider.yml) et à la main : node tools/stats-core-test.js */
'use strict';
require('../stats-core.js'); // définit globalThis.StatsCore
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

if (fails === 0) { console.log('\n✔ stats-core : tous les tests passent.'); process.exit(0); }
console.error('\n✖ stats-core : ' + fails + ' test(s) en échec.'); process.exit(1);
