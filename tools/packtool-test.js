#!/usr/bin/env node
/* Tests de non-régression des fonctions pures de l'assembleur de pack (tools/packtool.js).
   Verrouille : la reconnaissance des URLs CurseForge de TOUTE catégorie (mods, textures, shaders),
   le type déduit de la catégorie, le refus de tout ce qui n'est pas une vraie archive ZIP (page HTML),
   et la fusion de fichiers (applyMode). CI + manuel. */
'use strict';
const pt = require('./packtool.js');

let fails = 0;
const ok = (name, cond) => { console.log((cond ? '  PASS ' : '  FAIL ') + name); if (!cond) fails++; };
const eq = (name, got, want) => ok(`${name} (= ${JSON.stringify(want)}, got ${JSON.stringify(got)})`, JSON.stringify(got) === JSON.stringify(want));

console.log('packtool (assembleur de pack) — non-régression');

// parseCurseforge : toutes les catégories, /download/ ET /files/
{
  const tex = pt.parseCurseforge({ url: 'https://www.curseforge.com/minecraft/texture-packs/motschens-better-leaves/download/7556678' });
  eq('CF texture-pack /download/ → catégorie+slug+fileId', [tex.category, tex.slug, tex.fileId], ['texture-packs', 'motschens-better-leaves', '7556678']);
  const mod = pt.parseCurseforge({ url: 'https://www.curseforge.com/minecraft/mc-mods/sodium/files/6543210' });
  eq('CF mc-mods /files/ → catégorie mc-mods', [mod.category, mod.fileId], ['mc-mods', '6543210']);
  const sha = pt.parseCurseforge({ url: 'https://www.curseforge.com/minecraft/shaders/complementary-reimagined/download/8123288' });
  eq('CF shaders → catégorie shaders', [sha.category, sha.fileId], ['shaders', '8123288']);
  const none = pt.parseCurseforge({ url: 'https://modrinth.com/shader/complementary-reimagined' });
  eq('URL non-CurseForge → rien extrait', [none.category, none.fileId], [null, null]);
}

// typeFromCategory : catégorie → dossier
eq('type texture-packs → resourcepack', pt.typeFromCategory('texture-packs'), 'resourcepack');
eq('type shaders → shaderpack', pt.typeFromCategory('shaders'), 'shaderpack');
eq('type mc-mods → mod', pt.typeFromCategory('mc-mods'), 'mod');
eq('type inconnu → mod', pt.typeFromCategory('customization'), 'mod');
eq('type null → mod', pt.typeFromCategory(null), 'mod');

// looksLikeZip : signature « PK » obligatoire (sinon page HTML/garbage refusée)
ok('ZIP PK\\x03\\x04 accepté', pt.looksLikeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])));
ok('ZIP vide PK\\x05\\x06 accepté', pt.looksLikeZip(Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0])));
ok('page HTML (<!DOCTYPE) REFUSÉE', !pt.looksLikeZip(Buffer.from('<!DOCTYPE html><html>...')));
ok('page HTML (<html) REFUSÉE', !pt.looksLikeZip(Buffer.from('<html>err</html>')));
ok('tampon trop court REFUSÉ', !pt.looksLikeZip(Buffer.from([0x50, 0x4b])));
ok('non-buffer REFUSÉ', !pt.looksLikeZip('PK\x03\x04'));

// safeName : espaces/caractères spéciaux → _ (correspondance URL↔asset GitHub)
eq('safeName espaces → _', pt.safeName('Fast Better Grass.zip'), 'Fast_Better_Grass.zip');
eq('safeName déjà propre inchangé', pt.safeName('Better-Leaves-9.5.zip'), 'Better-Leaves-9.5.zip');
eq('safeName points conservés', pt.safeName('Fast.Better.Grass.zip'), 'Fast.Better.Grass.zip');
eq('safeName accents/caractères → _', pt.safeName('Complémentaire (v2).zip'), 'Compl_mentaire_v2_.zip');
eq('safeName vide → fichier', pt.safeName(''), 'fichier');
ok('safeName underscores en trop nettoyés', !/^_|_$/.test(pt.safeName('  bord  ')));

// applyMode : fusion inchangée (mods remplacés en mode replace ; textures/mods ajoutés)
{
  const cur = [{ path: 'mods/a.jar' }, { path: 'mods/b.jar' }, { path: 'resourcepacks/old.zip' }];
  const added = [{ path: 'mods/c.jar' }];
  const addRes = pt.applyMode(cur, 'add', added, []);
  eq('add : garde tout + ajoute', addRes.map((f) => f.path), ['mods/a.jar', 'mods/b.jar', 'resourcepacks/old.zip', 'mods/c.jar']);
  const repRes = pt.applyMode(cur, 'replace', added, []);
  eq('replace : vide les mods/, garde le resourcepack, ajoute', repRes.map((f) => f.path), ['resourcepacks/old.zip', 'mods/c.jar']);
  const rmRes = pt.applyMode(cur, 'add', [], ['mods/b.jar']);
  eq('removePaths honoré', rmRes.map((f) => f.path), ['mods/a.jar', 'resourcepacks/old.zip']);
}

// curseforgeFile : résolution du fichier par NUMÉRO direct (POST /v1/mods/files), repli par projet.
// On bouchonne global.fetch pour ne pas toucher le réseau.
(async () => {
  const realFetch = global.fetch;
  const mk = (obj) => ({ ok: true, status: 200, json: async () => obj });
  const err404 = { ok: false, status: 404, json: async () => ({}) };

  // 1) Le numéro direct suffit → PAS de recherche par slug (pas de 404 possible).
  let calls = [];
  global.fetch = async (url, opts) => {
    calls.push((opts && opts.method) || 'GET');
    if (url === 'https://api.curseforge.com/v1/mods/files') return mk({ data: [{ id: 7670377, fileName: 'Cool-Pack-1.2.zip', downloadUrl: 'https://edge.forgecdn.net/files/7670/377/Cool-Pack-1.2.zip' }] });
    throw new Error('ne devrait pas être appelé : ' + url);
  };
  let f = await pt.curseforgeFile({ fileId: '7670377', slug: 'peu-importe' }, 'KEY');
  eq('CF par numéro direct → bon fichier', [f.fileName, f.id], ['Cool-Pack-1.2.zip', 7670377]);
  ok('CF par numéro direct → une seule requête (POST), pas de recherche slug', calls.join() === 'POST');

  // 2) POST échoue (404) → repli : recherche projet par slug PUIS fichier.
  calls = [];
  global.fetch = async (url, opts) => {
    const m = (opts && opts.method) || 'GET';
    calls.push(m + ' ' + url);
    if (url === 'https://api.curseforge.com/v1/mods/files') return err404;
    if (url.includes('/mods/search?')) return mk({ data: [{ id: 424242 }] });
    if (url === 'https://api.curseforge.com/v1/mods/424242/files/7670377') return mk({ data: { id: 7670377, fileName: 'Repli-2.0.zip', downloadUrl: 'https://edge.forgecdn.net/files/x/Repli-2.0.zip' } });
    throw new Error('URL inattendue : ' + url);
  };
  f = await pt.curseforgeFile({ fileId: '7670377', slug: 'mon-mod' }, 'KEY');
  eq('CF repli slug→projet→fichier', f.fileName, 'Repli-2.0.zip');
  ok('CF repli : a bien cherché le projet par slug', calls.some((c) => c.includes('/mods/search?')));

  // 3) POST renvoie une liste vide → repli aussi.
  global.fetch = async (url, opts) => {
    if (url === 'https://api.curseforge.com/v1/mods/files') return mk({ data: [] });
    if (url.includes('/mods/search?')) return mk({ data: [{ id: 999 }] });
    if (url.endsWith('/mods/999/files/111')) return mk({ data: { id: 111, fileName: 'Vide-Repli.zip' } });
    throw new Error('URL inattendue : ' + url);
  };
  f = await pt.curseforgeFile({ fileId: '111', slug: 's' }, 'KEY');
  eq('CF POST vide → repli projet', f.fileName, 'Vide-Repli.zip');

  global.fetch = realFetch;

  if (fails === 0) { console.log('\n✔ packtool : tous les tests passent.'); process.exit(0); }
  console.error('\n✖ packtool : ' + fails + ' test(s) en échec.'); process.exit(1);
})();
