#!/usr/bin/env node
/* Tests de « La rétro du lundi » (tools/retro-lundi.js) — fonctions pures, sans réseau. */
'use strict';
const { buildRetro, applyRetro, weekDays } = require('./retro-lundi.js');

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };

console.log('rétro du lundi — non-régression');

const NOW = '2026-07-06T05:15:00.000Z'; // un lundi
const win = weekDays(NOW);
check('fenêtre = 7 jours pleins se terminant la veille', win.length === 7 && win[0] === '2026-06-29' && win[6] === '2026-07-05');

const stats = {
  seen: {
    Alex: { first: '2026-07-01T10:00:00Z', minutes: 100 }, // nouveau cette semaine
    Bob: { first: '2026-05-01T10:00:00Z', minutes: 500 },  // ancien
  },
  records: { peakPlayers: { value: 6, day: '2026-07-03' } },
  days: {
    '2026-07-01': { ses: { Alex: [[0, 3600]], Bob: [[0, 7200]] } }, // 1 h + 2 h
    '2026-06-20': { ses: { Bob: [[0, 36000]] } },                   // HORS fenêtre
  },
};
const entry = buildRetro(stats, NOW);
check('actu produite', !!entry && entry.id === 'retro-2026-07-06' && entry.date === '2026-07-06');
check('heures et joueurs justes (3 h, 2 joueurs)', !!entry && entry.body.includes('3 h de jeu') && entry.body.includes('2 joueurs'));
check('nouveau joueur compté', !!entry && entry.body.includes('1 nouveau venu'));
check('record de pic mentionné', !!entry && entry.body.includes('6 joueurs en même temps'));
check('semaine vide → null', buildRetro({ days: {}, seen: {} }, NOW) === null);
check('hors fenêtre seulement → null', buildRetro({ days: { '2026-06-20': { ses: { Bob: [[0, 3600]] } } }, seen: {} }, NOW) === null);

{
  const doc = { news: [] };
  check('applyRetro insère en tête', applyRetro(doc, entry) === true && doc.news[0].id === entry.id);
  check('applyRetro refuse le doublon (re-run)', applyRetro(doc, entry) === false && doc.news.length === 1);
  const doc2 = { news: Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i })) };
  applyRetro(doc2, entry);
  check('plafond 30 actus respecté', doc2.news.length === 30 && doc2.news[0].id === entry.id);
}

if (fails === 0) { console.log('\n✔ rétro : tous les tests passent.'); process.exit(0); }
console.error('\n✖ rétro : ' + fails + ' test(s) en échec.'); process.exit(1);
