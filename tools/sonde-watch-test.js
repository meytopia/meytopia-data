#!/usr/bin/env node
/* Tests de la surveillance serveur (tools/sonde-watch.js) : ping direct (Server List Ping) sur un
   serveur bouchonné up/down, décodage/encodage de l'état d'escalade, et paliers de rappel dus.
   Ne touche ni GitHub ni Discord (on ne teste que les fonctions pures + le ping local). CI + manuel. */
'use strict';
const net = require('net');
const sw = require('./sonde-watch.js');

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const eq = (name, got, want) => ok(`${name} (= ${JSON.stringify(want)}, got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

(async () => {
  console.log('sonde-watch (surveillance serveur) — non-régression');

  // ── marker / parseState : aller-retour ──
  const mk = sw.marker('2026-07-06T12:00:00.000Z', [5, 15]);
  ok('marker contient downSince + notified', /downSince=2026-07-06T12:00:00\.000Z notified=5,15/.test(mk));
  eq('parseState relit l\'état', sw.parseState('blabla\n' + mk + '\nfin'), { downSince: '2026-07-06T12:00:00.000Z', notified: [5, 15] });
  eq('parseState sans marqueur → null', sw.parseState('aucun marqueur ici'), null);
  eq('parseState notified vide', sw.parseState(sw.marker('2026-07-06T12:00:00.000Z', [])), { downSince: '2026-07-06T12:00:00.000Z', notified: [] });

  // ── dueReminders : paliers 5/15/30/60 ──
  const now = Date.UTC(2026, 6, 6, 12, 0, 0);
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  eq('3 min → aucun palier', sw.dueReminders(at(3), [], now).due, []);
  eq('7 min → palier 5', sw.dueReminders(at(7), [], now).due, [5]);
  eq('7 min mais 5 déjà notifié → rien', sw.dueReminders(at(7), [5], now).due, []);
  eq('20 min, 5 fait → palier 15', sw.dueReminders(at(20), [5], now).due, [15]);
  eq('65 min, 5/15/30 faits → palier 60', sw.dueReminders(at(65), [5, 15, 30], now).due, [60]);
  eq('65 min tout notifié → rien', sw.dueReminders(at(65), [5, 15, 30, 60], now).due, []);
  eq('cron en retard (40 min d\'un coup) → 5,15,30 rattrapés', sw.dueReminders(at(40), [], now).due, [5, 15, 30]);

  // ── serverReachable : serveur bouchonné qui RÉPOND → en ligne ──
  const server = net.createServer((sock) => { sock.on('data', () => { try { sock.write(Buffer.from([0x02, 0x00, 0x01])); } catch { /* ignore */ } }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const upPort = server.address().port;
  ok('serveur qui répond → EN LIGNE', (await sw.serverReachable('127.0.0.1', upPort)) === true);
  await new Promise((r) => server.close(r));

  // ── serveur ABSENT (port fermé) → hors ligne ──
  ok('port fermé → INJOIGNABLE', (await sw.serverReachable('127.0.0.1', upPort)) === false);

  if (fails === 0) { console.log('\n✔ sonde-watch : tous les tests passent.'); process.exit(0); }
  console.error('\n✖ sonde-watch : ' + fails + ' test(s) en échec.'); process.exit(1);
})().catch((e) => { console.error('ERREUR', e && e.stack || e); process.exit(1); });
