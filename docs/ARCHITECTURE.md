# Architecture

## Vue d'ensemble

```
 Téléphones (joueurs)        Écran animateur / vidéoprojecteur        Navigateur admin
        │  REST + SSE                 │  REST + SSE + audio                 │  REST (cookie admin)
        └──────────────┬──────────────┴──────────────┬──────────────────────┘
                       ▼                             ▼
              Vercel (CDN : JS, CSS, audio de démo) ── proxy ──▶ Backend Node.js persistant
                                                                  (server.js, une instance)
                                                                   ├─ SQLite (DATA_DIR/quizblitz.db)
                                                                   └─ Médias (DATA_DIR/media)
```

- **Backend autoritaire** (`server.js`) : machine à états des parties, minuteurs, validation des réponses, calcul des points, sessions, administration, rendu des pages avec la marque.
- **Temps réel** : Server-Sent Events (un flux par écran animateur, un par joueur) ; les actions passent par REST. À chaque (re)connexion, le serveur envoie un instantané complet : la reconnexion est naturelle.
- **Persistance** : SQLite intégré à Node (`node:sqlite`), aucune dépendance npm.
- **Vercel** : sert les fichiers statiques depuis son CDN et redirige pages, `/api` et `/media` vers le backend (même origine : cookies de première partie, aucun CORS). Voir `DEPLOIEMENT_VERCEL.md`.

## Séparation des responsabilités

| Responsabilité | Où |
|---|---|
| Configuration technique / variables d'environnement | `.env.example`, en-tête de `server.js` |
| Paramètres globaux et identité visuelle (source unique) | table `app_settings`, `lib/settings.js` |
| Authentification administrateur | `db.js` (`ensureAdmin`, sessions hachées), `server.js` (`handleAdmin`) |
| Contenu des blind tests | table `blind_tests`, `lib/blindtest.js` |
| Stockage des médias | table `media` (métadonnées) + pilote `lib/media.js` (octets) |
| Données des parties et des joueurs | mémoire + instantané `live_games` (`lib/gamestore.js`) |
| Scoring | `lib/scoring.js` |
| Temps réel | SSE dans `server.js` (`openStream`, `push`, `broadcastState`) |
| Questions et révélations (QCM, etc.) | `questions.js` |

## Cycle d'une partie de blind test

```
LOBBY ─start─▶ GET_READY (compte à rebours) ─▶ QUESTION (extrait joué + réponses ouvertes)
                    ▲  │ pause/reprise                  │ temps écoulé / tous ont répondu / « Révéler »
                    │  └── restart-track ◀──────────────┤
                    │                                    ▼
                    └── next ◀── SCOREBOARD ◀─ next ─ REVEAL (titre, artiste, année, pochette, points)
                                     │                 ▲ hide-board
                                     └── (dernier morceau) ─▶ ENDED (podium, rapport enregistré)
```

- Toutes les transitions sont horodatées par le serveur (`questionStartsAt`, `questionOpenedAt`, `endsAt`). Les minuteurs sont reconstruits depuis ces horodatages après une pause ou un redémarrage (`armTimers`).
- La pause fige le temps restant ; à la reprise, `questionOpenedAt` est décalé de la durée de pause pour qu'elle ne compte pas dans le temps de réponse.
- « Débloquer » (`recover`) renvoie l'état à tous les écrans et ré-arme les minuteurs, sans rien supprimer.

## Ce que voit chaque rôle

| Donnée | Admin | Écran animateur | Téléphone |
|---|---|---|---|
| URL audio de l'extrait | oui | oui (pendant le morceau) | **jamais** |
| Titre / artiste / année / pochette | oui | seulement à la révélation | seulement à la révélation |
| Bonne réponse | oui | seulement à la révélation | seulement à la révélation |
| Notes internes | oui | non | non |
| Scores | — | oui | les siens + rang |

Les URL des fichiers téléversés sont aléatoires (`/media/<32 hex>.mp3`) : elles ne révèlent pas la réponse.

## Droits

- **Admin** : cookie `qb_admin` (HttpOnly, SameSite=Strict, Secure en production, 12 h), limité à 5 tentatives de connexion / 15 min / IP.
- **Animateur** : `hostKey` aléatoire propre à chaque partie (comparaison à temps constant). L'admin peut la récupérer pour reprendre une partie (« Reprendre l'animation »).
- **Joueur** : jeton aléatoire propre à la partie, stocké dans le `sessionStorage` du téléphone (reconnexion après veille ou rafraîchissement).
- **CSRF** : toute requête modifiante exige l'en-tête `X-QuizBlitz: 1`, impossible à envoyer depuis un autre site sans pré-vol CORS (jamais accepté).

## Pilotes de stockage des médias

Interface (`lib/media.js`) :

```js
driver.put(key, buffer, mime)   // Promise<void>
driver.stat(key)                // Promise<{ size } | null>
driver.stream(key, { start, end }) // Readable (requêtes Range pour l'audio)
driver.remove(key)              // Promise<void>
```

Livré : `local` (fichiers dans `DATA_DIR/media`). Pour Vercel Blob, Cloudflare R2, S3 ou Supabase Storage,
ajouter un pilote qui implémente ces 4 méthodes et le sélectionner avec `MEDIA_STORAGE`. Recommandation :
servir les fichiers via le backend (comme aujourd'hui) ou via des URL publiques **non signées** à nom aléatoire,
pour éviter qu'une URL signée expire pendant une partie.

## Limites connues de l'architecture

- **Une seule instance backend** (l'état vivant est en mémoire, l'instantané en base sert à la reprise). Pour plusieurs instances : Redis pub/sub ou Ably pour diffuser, et un verrou par partie.
- SQLite exige un **disque persistant** sur l'hébergeur.
- Sans `qrcodejs` (CDN cdnjs) le QR code ne s'affiche pas (hors ligne) ; l'adresse et le PIN restent affichés.
