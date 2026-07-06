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

if (fails === 0) { console.log('\n✔ packtool : tous les tests passent.'); process.exit(0); }
console.error('\n✖ packtool : ' + fails + ' test(s) en échec.'); process.exit(1);
