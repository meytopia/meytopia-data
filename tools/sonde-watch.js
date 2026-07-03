#!/usr/bin/env node
/* Surveillance du serveur Meytopia (lancé par .github/workflows/sonde-watch.yml toutes les ~10 min).
   Lit live.json (branche stats, publié par la sonde toutes les 3 min) et décide :
   - online:false               → arrêt PROPRE (volontaire) : pas d'alerte, on ferme une éventuelle alerte ouverte
   - online:true + frais ≤15min → tout va bien : on ferme une éventuelle alerte ouverte (« rétabli »)
   - online:true + muet >15min  → panne présumée (crash/gel/coupure) : issue GitHub + message Discord
   L'issue ouverte sert d'état anti-spam (une seule alerte par panne) ET d'historique des pannes.
   Discord : optionnel (secret DISCORD_WEBHOOK) — sans lui, l'issue seule fait foi. */
'use strict';

const REPO = process.env.GITHUB_REPOSITORY || 'meytopia/meytopia-data';
const TOKEN = process.env.GITHUB_TOKEN;
const WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const STALE_MIN = 15; // la sonde bat toutes les 3 min → 5 battements manqués = panne présumée
const LABEL = 'sonde-alerte';
const TITLE = '🔴 Serveur injoignable (sonde muette)';

async function gh(pathname, opts = {}) {
  const res = await fetch('https://api.github.com' + pathname, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error('GitHub ' + res.status + ' sur ' + pathname);
  return res.status === 204 ? null : res.json();
}

async function discord(content) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
  } catch (e) { console.log('Discord injoignable (non bloquant) :', e.message); }
}

async function openIssues() {
  const list = await gh(`/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=10`);
  return Array.isArray(list) ? list : [];
}
// Filtré par TITRE : le label est partagé avec l'alerte « site pas à jour » (garde Pages) —
// sans ce filtre, l'une serait prise pour l'autre.
async function openAlert() {
  return (await openIssues()).find((i) => i.title === TITLE) || null;
}

/* ── Garde GitHub Pages : le site (régie + pages publiques) doit suivre main ──
   Pages a déjà raté 4 déploiements en 24 h EN SILENCE (échec ou build coincé) : la page servait
   une vieille version sans que personne ne le sache. À chaque passage (10 min), on vérifie le
   dernier build ; raté/coincé/en retard → on RELANCE un build (le remède qui marche à chaque
   fois). Si ça dure malgré les relances (> 45 min de retard), une issue prévient l'admin.
   Best-effort : ce garde ne doit JAMAIS empêcher la surveillance de panne serveur de tourner. */
const PAGES_TITLE = '🔴 Site pas à jour (GitHub Pages en panne)';
async function checkPages() {
  try {
    const build = await gh(`/repos/${REPO}/pages/builds/latest`).catch(() => null);
    if (!build || !build.status) { console.log('Pages : état illisible — passage sans action.'); return; }
    const head = await gh(`/repos/${REPO}/commits/main`);
    const headAgeMin = Math.round((Date.now() - new Date(head.commit.committer.date).getTime()) / 60000);
    const buildAgeMin = Math.round((Date.now() - new Date(build.created_at).getTime()) / 60000);
    // 'queued' = en file (c'est AUSSI l'état d'un build coincé, et celui que renvoie notre relance) :
    // à traiter comme 'building', jamais comme sain.
    const enCours = build.status === 'building' || build.status === 'queued';
    const aJour = build.status === 'built' && build.commit === head.sha;
    const enRetard = build.status === 'built' && build.commit !== head.sha && headAgeMin > 15;
    const enPanne = build.status === 'errored' || (enCours && buildAgeMin > 10) || enRetard;
    const pagesIssue = (await openIssues()).find((i) => i.title === PAGES_TITLE) || null;
    // L'issue ne se ferme QUE quand le site sert VRAIMENT la dernière version — pas sur un simple
    // build en cours (qui peut encore échouer) : sinon flip-flop « reparti »/« cassé » et faux espoirs.
    if (aJour) {
      if (pagesIssue) {
        await gh(`/repos/${REPO}/issues/${pagesIssue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: '✅ Le site est reparti et sert la dernière version. Fin de l\'alerte.' }) });
        await gh(`/repos/${REPO}/issues/${pagesIssue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      }
      console.log('Pages : OK (à jour).');
      return;
    }
    if (!enPanne) {
      console.log(`Pages : en cours (${build.status}, il y a ${buildAgeMin} min) — on laisse finir.`);
      return;
    }
    console.log(`Pages : problème (status=${build.status}, build il y a ${buildAgeMin} min, dernier commit il y a ${headAgeMin} min) → relance d'un build.`);
    await gh(`/repos/${REPO}/pages/builds`, { method: 'POST' }).catch((e) => console.log('Relance refusée (non bloquant) :', e.message));
    // Durée RÉELLE de la panne : depuis combien de temps main n'est-il pas servi ? Le dernier build
    // ne suffit pas (chaque relance remettrait le chrono à zéro) : on regarde le dernier build RÉUSSI.
    let dureDepuisMin = headAgeMin;
    try {
      const builds = await gh(`/repos/${REPO}/pages/builds?per_page=10`);
      const ok = Array.isArray(builds) ? builds.find((b) => b && b.status === 'built') : null;
      if (ok && ok.commit === head.sha) dureDepuisMin = 0; // la dernière version est en fait déjà servie
    } catch (e) { /* estimation par headAgeMin conservée */ }
    // Toujours cassé depuis > 45 min malgré les relances des passages précédents → on prévient (une seule fois).
    if (!pagesIssue && dureDepuisMin > 45) {
      const body = [
        'La publication du site (GitHub Pages) échoue ou reste coincée depuis plus de 45 minutes,',
        'malgré les relances automatiques toutes les 10 minutes.',
        '',
        '**Conséquence** : la régie et les pages publiques servent une ANCIENNE version — les dernières publications ne sont pas visibles.',
        '**Rien à faire côté Meytopia** : c\'est la machinerie GitHub qui patine (vérifier https://www.githubstatus.com).',
        'Cette issue se fermera toute seule dès que le site sera reparti.',
      ].join('\n');
      const issue = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: PAGES_TITLE, body, labels: [LABEL] }) });
      await discord(`🟠 **Meytopia** — le site (régie/pages publiques) n'arrive plus à se mettre à jour depuis ${dureDepuisMin} min (panne GitHub Pages). Relances automatiques en cours. ${issue.html_url}`);
      console.log('Alerte site créée : #' + issue.number);
    }
  } catch (e) {
    console.log('Garde Pages en échec (non bloquant) :', e.message);
  }
}

function fmtParis(iso) {
  try { return new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

(async () => {
  // 0) Garde Pages (site à jour) — AVANT la lecture de live.json : même si la sonde n'a jamais
  //    publié, le site doit être surveillé. Best-effort, jamais bloquant.
  await checkPages();

  // 1) Lire live.json (cache-buster : raw.githubusercontent cache ~5 min)
  let live = null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/stats/live.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) live = await res.json();
  } catch (e) { /* réseau/branche absente → traité ci-dessous */ }

  if (!live || !live.updatedAt) {
    console.log('live.json indisponible ou sans updatedAt — la sonde n\'a peut-être jamais publié. Aucune action.');
    return;
  }

  const ageMin = Math.round((Date.now() - new Date(live.updatedAt).getTime()) / 60000);
  const alert = await openAlert();
  console.log(`live.json : online=${live.online} · dernier battement il y a ${ageMin} min · alerte ouverte : ${alert ? '#' + alert.number : 'aucune'}`);

  // 2) Serveur éteint PROPREMENT → jamais d'alerte ; on solde une éventuelle panne passée.
  if (live.online === false) {
    if (alert) {
      await gh(`/repos/${REPO}/issues/${alert.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ Le serveur a été arrêté proprement (dernier battement : ${fmtParis(live.updatedAt)}). Fin de l'alerte.` }) });
      await gh(`/repos/${REPO}/issues/${alert.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      await discord(`✅ **Meytopia** — fin d'alerte : le serveur a été arrêté proprement.`);
    }
    return;
  }

  // 3) Sonde fraîche → tout va bien ; on ferme une éventuelle alerte (« rétabli »).
  if (ageMin <= STALE_MIN) {
    if (alert) {
      await gh(`/repos/${REPO}/issues/${alert.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `✅ Rétabli : la sonde publie à nouveau (dernier battement : ${fmtParis(live.updatedAt)}).` }) });
      await gh(`/repos/${REPO}/issues/${alert.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
      await discord(`✅ **Meytopia est de retour !** Le serveur répond à nouveau.`);
    }
    return;
  }

  // 4) Panne présumée : dernier état « en ligne » mais plus aucun battement depuis > 15 min.
  if (alert) { console.log('Panne déjà signalée (#' + alert.number + ') — pas de re-notification.'); return; }
  const body = [
    `La sonde n'a plus publié depuis **${ageMin} min** alors que le dernier état du serveur était **en ligne**.`,
    ``,
    `- Dernier battement : ${fmtParis(live.updatedAt)} (Europe/Paris)`,
    `- Causes possibles : crash du serveur, gel (freeze), coupure réseau/hébergeur, panne GitHub côté sonde.`,
    ``,
    `Cette issue se fermera automatiquement dès que la sonde publiera à nouveau (ou après un arrêt propre).`,
  ].join('\n');
  const issue = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) });
  await discord(`🔴 **Meytopia ne répond plus !** Aucun battement de la sonde depuis ${ageMin} min (dernier état : en ligne). Détails : ${issue.html_url}`);
  console.log('Alerte créée : #' + issue.number);
})().catch((e) => { console.error('sonde-watch en échec :', e.message); process.exit(1); });
