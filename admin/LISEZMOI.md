# 🎛 Régie Meytopia — le panneau d'administration

Une seule page (`admin/index.html`), zéro serveur : elle parle directement à l'API GitHub.
Chaque action devient un commit signé du nom de l'admin, validé par le garde-fou CI,
et atterrit dans les launchers des joueurs en ~5 minutes.

## Mise en service (une fois, par Alexis)

1. Committer ce dossier `admin/` dans `meytopia-data` et pousser.
2. Sur GitHub : `meytopia-data → Settings → Pages` → Source : **Deploy from a branch** →
   Branche : **main**, dossier **/(root)** → Save.
3. Deux minutes plus tard, le panneau est en ligne :
   **https://meytopia.github.io/meytopia-data/admin/**
   (La page fonctionne aussi ouverte en local, directement depuis le fichier.)

## Ajouter un admin

1. `meytopia-data → Settings → Collaborators` → inviter son compte GitHub (accès **Write**).
2. L'admin crée son propre jeton.
   **Compte de service Meytopia (Admin-…)** : `Settings → Developer settings →
   Personal access tokens → Tokens (classic)` → Generate new token (classic),
   note « Regie Meytopia », expiration 90 jours, cocher **uniquement la case repo**.
   (GitHub ne propose pas les jetons fine-grained aux collaborateurs d'un dépôt
   personnel ; ces comptes n'ayant accès qu'à `meytopia-data`, la portée est identique.)
   **Compte personnel possédant d'autres dépôts** : préférer un fine-grained limité
   à `meytopia-data` avec Contents : Read and write.
3. Il colle le jeton sur la page de connexion. C'est tout.

Chaque admin a SON jeton : les commits portent son nom (traçabilité), et révoquer
un accès = retirer le collaborateur ou révoquer son jeton.

## Ce que le panneau pilote

- **Tableau de bord** — l'état tel que les joueurs le voient, + statut du serveur en direct.
- **Maintenance** — bandeau + blocage du bouton Jouer, message, heure annoncée.
- **Événement** — bannière à compte à rebours : titre, message, dates, couleur, lien.
- **Actualités** — créer, modifier, supprimer les annonces de l'onglet Actus.
- **Changelog** — ajouter une note manuelle au « Quoi de neuf ».
- **Réglages** — couleur d'accent, nom du serveur, intervalle de statut, version minimale (zone sensible, avec confirmation).
- **Stats** — téléchargements des releases launcher et pack.

## Sécurité, en clair

- Le jeton ne quitte jamais le navigateur (envoyé uniquement à `api.github.com`) ;
  il est mémorisé sur l'appareil seulement si la case est cochée.
- La page **valide** chaque modification avant de la publier (mêmes règles que `valider.js`),
  puis la CI du dépôt revérifie derrière : deux filets.
- Si deux admins publient en même temps, le panneau détecte le conflit,
  recharge la dernière version et demande de réappliquer.
