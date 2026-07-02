#!/usr/bin/env node
/* Test de non-régression de la RÉGIE (admin/index.html — JS inline).
   Extrait les fonctions pures du fichier par ancres et les vérifie sans navigateur :
   - syntaxe du script inline complet (un HTML cassé = régie morte pour l'admin)
   - validate() : accepte les fichiers RÉELS du dépôt (sinon toute publication serait bloquée)
     et rejette les données malformées (launcher.json sans manifestUrl, blocklist trop large…)
   - normalizeStatsData : filtre anti-injection des clés de date (sécurité XSS)
   - blScope : scope blocklist émis seulement s'il appartient au vocabulaire validé
   Lancé en CI (valider.yml) et à la main : node tools/regie-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'admin', 'index.html'), 'utf8');

let fails = 0;
const check = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };

console.log('régie (admin/index.html) — non-régression');

// 1) Syntaxe : chaque <script> inline doit parser
{
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0, bad = 0;
  while ((m = re.exec(html))) {
    const codeJs = m[1];
    if (!codeJs.trim()) continue;
    n++;
    try { new vm.Script(codeJs); } catch (e) { bad++; console.error('  ERREUR SYNTAXE script #' + n + ' : ' + e.message); }
  }
  check(`syntaxe des ${n} script(s) inline`, n > 0 && bad === 0);
}

// 2) validate() extrait (des helpers isStr… jusqu'à la fin de la fonction)
function extractValidate() {
  const start = html.indexOf('const isStr = (v) => typeof v ===');
  const ridx = html.indexOf('return errs;', start);
  const end = html.indexOf('}', ridx);
  if (start < 0 || ridx < 0) throw new Error('extraction validate() impossible — ancres déplacées ?');
  const mod = { exports: {} };
  new Function('module', html.slice(start, end + 1) + '\nmodule.exports = validate;')(mod);
  return mod.exports;
}
const validate = extractValidate();
const launcher = JSON.parse(fs.readFileSync(path.join(ROOT, 'launcher.json'), 'utf8'));
const blocklist = JSON.parse(fs.readFileSync(path.join(ROOT, 'blocklist.json'), 'utf8'));
check('validate(launcher.json réel) = 0 erreur', validate('launcher.json', launcher).length === 0);
check('validate(blocklist.json réel) = 0 erreur', validate('blocklist.json', blocklist).length === 0);
{
  const bad = JSON.parse(JSON.stringify(launcher)); delete bad.modpack.manifestUrl;
  check('launcher sans manifestUrl rejeté', validate('launcher.json', bad).length > 0);
  const bad2 = JSON.parse(JSON.stringify(launcher)); delete bad2.server.host;
  check('launcher sans server.host rejeté', validate('launcher.json', bad2).length > 0);
}
check('blocklist match vide rejetée', validate('blocklist.json', { entries: [{ match: {}, scope: ['mods'] }] }).length > 0);
check('blocklist contains 1 caractère rejetée', validate('blocklist.json', { entries: [{ match: { contains: 'x' }, scope: ['mods'] }] }).length > 0);
check('blocklist deux critères rejetée', validate('blocklist.json', { entries: [{ match: { contains: 'xray', sha1: 'a'.repeat(40) }, scope: ['mods'] }] }).length > 0);
check('blocklist scope invalide rejetée', validate('blocklist.json', { entries: [{ match: { contains: 'xray' }, scope: ['worlds'] }] }).length > 0);
check('blocklist règle valide acceptée', validate('blocklist.json', { entries: [{ match: { contains: 'xray' }, scope: ['mods'], reason: 'x' }] }).length === 0);
const gifts = JSON.parse(fs.readFileSync(path.join(ROOT, 'gifts.json'), 'utf8'));
check('validate(gifts.json réel) = 0 erreur', validate('gifts.json', gifts).length === 0);
check('gifts id injection rejeté', validate('gifts.json', { enabled: true, goldenChance: 0.05, items: [{ id: 'minecraft:apple 1; op Hacker', count: 1 }] }).length > 0);
check('gifts quantité 0 rejetée', validate('gifts.json', { enabled: true, goldenChance: 0.05, items: [{ id: 'minecraft:apple', count: 0 }] }).length > 0);
check('gifts label dangereux rejeté', validate('gifts.json', { enabled: true, goldenChance: 0.05, items: [{ id: 'minecraft:apple', count: 1, label: '<img src=x>' }] }).length > 0);
check('gifts goldenChance 2 rejetée', validate('gifts.json', { enabled: true, goldenChance: 2, items: [] }).length > 0);

// 3) normalizeStatsData : filtre anti-injection des clés de date (les clés finissent en innerHTML)
function extractNormalize() {
  const start = html.indexOf('const UP_MERGE_GAP_SEC = 300;');
  const ridx = html.indexOf('function normalizeStatsData');
  const rend = html.indexOf('return out;', ridx);
  const end = html.indexOf('}', rend);
  if (start < 0 || ridx < 0) throw new Error('extraction normalizeStatsData impossible — ancres déplacées ?');
  const mod = { exports: {} };
  new Function('module', html.slice(start, end + 1) + '\nmodule.exports = normalizeStatsData;')(mod);
  return mod.exports;
}
const normalize = extractNormalize();
{
  const evil = 'a"><img src=x onerror=alert(1)>';
  const data = { version: 5, days: { '2026-07-01': { up: [[0, 120]], ses: {} } } };
  data.days[evil] = { up: [[0, 60]], ses: {} };
  const out = normalize(data);
  const keys = Object.keys(out.days);
  check('clé de date valide conservée', keys.includes('2026-07-01'));
  check('clé de date malveillante rejetée (anti-XSS)', keys.length === 1);
}

// 4) blScope : scope émis seulement s'il est dans le vocabulaire validé, omis sinon
function extractBlScope() {
  const start = html.indexOf('const BL_SCOPES');
  const end = html.indexOf('const modsSel', start);
  if (start < 0 || end < 0) throw new Error('extraction blScope impossible — ancres déplacées ?');
  const mod = { exports: {} };
  new Function('module', html.slice(start, end) + '\nmodule.exports = blScope;')(mod);
  return mod.exports;
}
const blScope = extractBlScope();
check('blScope(mods/a.jar) → scope mods', JSON.stringify(blScope('mods/a.jar')) === '{"scope":["mods"]}');
check('blScope(config/x.json) → omis', JSON.stringify(blScope('config/x.json')) === '{}');
check('blScope(options.txt) → omis', JSON.stringify(blScope('options.txt')) === '{}');

// 5) RGPD : rgpdCollectUuids + rgpdScrub — retrait d'un joueur d'une archive v5 sans toucher au reste
function extractRgpd() {
  const start = html.indexOf('function rgpdCollectUuids');
  const ridx = html.lastIndexOf('return touched;', html.indexOf('async function rgpdRemovePlayer'));
  const end = html.indexOf('}', ridx);
  if (start < 0 || ridx < 0) throw new Error('extraction rgpd impossible — ancres déplacées ?');
  const mod = { exports: {} };
  new Function('module', html.slice(start, end + 1) + '\nmodule.exports = { rgpdCollectUuids, rgpdScrub };')(mod);
  return mod.exports;
}
const { rgpdCollectUuids, rgpdScrub } = extractRgpd();
function archiveFixture() {
  return {
    version: 5,
    server: { season: 2 },
    seen: {
      Alex: { uuid: 'u1', minutes: 100, mc: { mobKills: 5 } },
      Bob: { uuid: 'u2', minutes: 50, mc: { mobKills: 3 } },
    },
    records: { peakPlayers: { value: 4, day: '2026-06-01' }, longestSession: { minutes: 90, player: 'Alex' } },
    priv: { u1: true },
    privCount: 1,
    claimed: { 2: { defi1: { u1: true, u2: true } } },
    baseline: { u1: { mobKills: 1 }, u2: { mobKills: 0 } },
    sessionLog: [{ n: 'Alex', u: 'u1', m: 30 }, { n: 'Bob', u: 'u2', m: 20 }],
    agg: { totalPlayMinutes: 150, mobKills: 8 },
    days: { '2026-06-01': { up: [[0, 3600]], ses: { Alex: [[0, 1800]], Bob: [[0, 1200]] }, perf: {} } },
  };
}
{
  const d = archiveFixture();
  const uuids = new Set();
  rgpdCollectUuids(d, 'Alex', uuids);
  check('rgpd : UUID du pseudo collecté', uuids.has('u1') && uuids.size === 1);
  check('rgpd : scrub renvoie true si retiré', rgpdScrub(d, 'Alex', uuids) === true);
  check('rgpd : seen[joueur] effacé, les autres restent', !d.seen.Alex && !!d.seen.Bob);
  check('rgpd : sessions du jour effacées, celles des autres restent', !d.days['2026-06-01'].ses.Alex && !!d.days['2026-06-01'].ses.Bob);
  check('rgpd : record de session du joueur effacé, record anonyme conservé', !d.records.longestSession && d.records.peakPlayers.value === 4);
  check('rgpd : sessionLog purgé par pseudo/UUID', d.sessionLog.length === 1 && d.sessionLog[0].n === 'Bob');
  check('rgpd : claimed purgé par UUID (récompense de l\'autre conservée)', !d.claimed[2].defi1.u1 && d.claimed[2].defi1.u2 === true);
  check('rgpd : baseline + priv purgés par UUID', !d.baseline.u1 && !!d.baseline.u2 && !d.priv.u1);
  check('rgpd : totaux communautaires anonymes (agg) intacts', d.agg.totalPlayMinutes === 150 && d.agg.mobKills === 8);
  check('rgpd : uptime/perf du jour intacts', d.days['2026-06-01'].up.length === 1);
}
{
  const d = archiveFixture();
  const before = JSON.stringify(d);
  check('rgpd : joueur inconnu → false et archive INCHANGÉE', rgpdScrub(d, 'Personne', new Set()) === false && JSON.stringify(d) === before);
}
{
  // Joueur RENOMMÉ : la vieille archive ne le connaît QUE sous son ANCIEN pseudo (seen, sessions,
  // record). Avec son UUID (collecté dans une archive récente sous le pseudo actuel), TOUT doit
  // disparaître — y compris les entrées nominatives sous l'ancien pseudo (trou trouvé à l'audit).
  const d = archiveFixture();
  d.seen.AncienPseudo = d.seen.Alex; delete d.seen.Alex; // même joueur (u1), ancien pseudo
  d.days['2026-06-01'].ses.AncienPseudo = d.days['2026-06-01'].ses.Alex; delete d.days['2026-06-01'].ses.Alex;
  d.records.longestSession.player = 'AncienPseudo';
  d.sessionLog[0] = { n: 'AncienPseudo', u: 'u1', m: 30 };
  check('rgpd : joueur renommé — l\'ancien pseudo est effacé partout via l\'UUID', rgpdScrub(d, 'Alex', new Set(['u1'])) === true
    && !d.seen.AncienPseudo && !!d.seen.Bob
    && !d.days['2026-06-01'].ses.AncienPseudo && !!d.days['2026-06-01'].ses.Bob
    && !d.records.longestSession
    && d.sessionLog.length === 1 && d.sessionLog[0].n === 'Bob'
    && !d.claimed[2].defi1.u1 && !d.baseline.u1);
}
{
  // Record d'un AUTRE joueur : jamais touché, même quand on retire quelqu'un d'autre.
  const d = archiveFixture();
  d.records.longestSession.player = 'Bob';
  rgpdScrub(d, 'Alex', new Set(['u1']));
  check('rgpd : record de session d\'un autre joueur conservé', d.records.longestSession.player === 'Bob');
}

// 6) Aperçu RGPD (rgpdApercuFichier) : compte ce qui SERAIT effacé, sans rien modifier
function extractApercu() {
  const start = html.indexOf('function rgpdCollectUuids');
  const ridx = html.indexOf('return det;', start);
  const end = html.indexOf('}', ridx);
  if (start < 0 || ridx < 0) throw new Error('extraction aperçu impossible — ancres déplacées ?');
  const mod = { exports: {} };
  new Function('module', html.slice(start, end + 1) + '\nmodule.exports = rgpdApercuFichier;')(mod);
  return mod.exports;
}
const rgpdApercuFichier = extractApercu();
{
  const d = archiveFixture();
  const avant = JSON.stringify(d);
  const det = rgpdApercuFichier(d, 'Alex', new Set(['u1']));
  check('aperçu : compte juste (1 profil, 1 jour, 1 record, 1 journal, 3 marqueurs)',
    !!det && det.profils === 1 && det.jours === 1 && det.record === 1 && det.journal === 1 && det.marqueurs === 3);
  check('aperçu : le fichier original est INTACT', JSON.stringify(d) === avant);
  check('aperçu : joueur inconnu → null', rgpdApercuFichier(archiveFixture(), 'Personne', new Set()) === null);
}

if (fails === 0) { console.log('\n✔ régie : tous les tests passent.'); process.exit(0); }
console.error('\n✖ régie : ' + fails + ' test(s) en échec.'); process.exit(1);
