# Analyse technique du projet existant

Audit réalisé sur le commit `9b3d0d1` (« Link the live demo in the README »), avant toute modification.

> Remarque : le cahier des charges indiquait que « les quiz sont enregistrés dans le navigateur ». Le dépôt
> est en réalité plus avancé : il possède déjà une base SQLite (comptes animateurs, bibliothèque de quiz,
> historique des parties). Le brouillon de l'éditeur reste, lui, dans le `localStorage`.

## 1. Architecture actuelle

| Élément | Constat |
|---|---|
| Runtime | Node.js ≥ 22.13, **zéro dépendance npm** (`http`, `crypto`, `node:sqlite` intégrés) |
| Serveur | `server.js` : un seul processus HTTP qui sert les fichiers statiques **et** l'API |
| Temps réel | Server-Sent Events : un flux par animateur (`/host-events`), un par joueur (`/events`) ; actions par REST POST |
| État des parties | `const games = new Map()` **en mémoire** ; timers `setTimeout` en mémoire |
| Persistance | SQLite (`data/quizblitz.db`) : `users`, `sessions`, `quizzes`, `games`, `players`, `answers` ; une partie n'est écrite **qu'à la fin** |
| Frontend | HTML + modules ES natifs, sans build : `index`, `host`, `play`, `library`, `reports` |
| QR code | bibliothèque `qrcodejs` chargée depuis cdnjs côté animateur |
| Sons | `public/sound.js` : musiques et effets synthétisés en Web Audio (pas de fichiers) |
| Déploiement | `render.yaml` (Render, offre gratuite, disque éphémère) |

## 2. Parcours d'un animateur

1. `/host` : éditeur de quiz (9 types de questions), brouillon dans `localStorage` (`quizblitz.draft`).
2. Optionnel : connexion (compte e-mail / mot de passe) pour enregistrer dans la bibliothèque (`/library`).
3. « Host live game » → `POST /api/games` → reçoit `{ pin, hostKey }`, stockés en `sessionStorage`.
4. Lobby : URL de connexion (IP du réseau local si `localhost`), PIN, QR code `…/play?pin=XXXXXX`, liste des joueurs (exclusion, verrouillage).
5. « Start » → décompte de 4 s → question → révélation → classement → … → podium animé → rapport.
6. Rafraîchissement : la partie est reprise grâce au `sessionStorage` (`quizblitz.hosting`).

## 3. Parcours d'un joueur

1. Scan du QR → `/play?pin=XXXXXX` : le PIN est pré-rempli et vérifié (`GET /api/games/:pin`).
2. Pseudo (ou générateur de pseudos) → `POST /join` → `{ playerId, token }` stockés en `sessionStorage`.
3. Flux SSE `/events?token=` : instantané complet à chaque (re)connexion → reconnexion naturelle.
4. Avatar modifiable dans le lobby ; réponses via `POST /answer` ; résultat, rang, écart avec le joueur précédent.

## 4. Cycle complet d'une partie

```
LOBBY --start--> GET_READY (4 s, timer) --> QUESTION (q.time s + 400 ms de grâce, timer)
   ^                                              | (tout le monde a répondu / skip / temps écoulé)
   |                                              v
 (fin) <-- ENDED <-- SCOREBOARD <--next-- REVEAL (scores calculés côté serveur)
                         |--next--> GET_READY (question suivante)
```

Le serveur est l'autorité : temps de réponse mesuré à la réception (`receivedAt - questionOpenedAt`),
points calculés côté serveur, bonne réponse jamais envoyée avant `REVEAL` (`Q.publicView`).

## 5. Fichiers et fonctions importants

| Fichier | Rôle | Fonctions clés |
|---|---|---|
| `server.js` | routage, machine à états, SSE | `newPin`, `scoreAnswer`, `streakBonus`, `hostSnapshot`, `playerSnapshot`, `startGetReady`, `startQuestion`, `endQuestion`, `goNext`, `finishGame`, `handleApi` |
| `questions.js` | types de questions | `validateQuiz`, `prepareForGame`, `publicView`, `parseAnswer`, `judge`, `revealSummary` |
| `db.js` | SQLite | comptes (scrypt, sessions hachées), bibliothèque, `saveGame`, rapports, CSV |
| `filter.js` | filtre de pseudos | `isOffensive`, `randomName`, `cleanText` |
| `public/shared.js` | helpers front | `api` (en-tête CSRF `X-QuizBlitz`), `el`, `countdown` (horloge synchronisée), `stream`, `avatarEl` |
| `public/host.js` | éditeur + écran de jeu | lobby/QR, rendu par état, podium |
| `public/play.js` | téléphone | jonction, reconnexion, saisie des réponses |
| `public/sound.js` | audio synthétisé | `unlock`, `lobbyMusic`, `questionMusic`, effets |
| `test/e2e.js`, `test/features.js` | tests API contre un serveur lancé à part | |

## 6. Éléments réutilisables

- **Machine à états et scoring** (serveur autoritaire, horodatage serveur, grâce réseau) : conservés.
- **SSE + instantanés** : modèle de reconnexion simple et robuste, conservé.
- `questions.js` type `quiz` (4 choix) : un morceau de blind test QCM **devient** une question `quiz` enrichie (audio, révélation). Toute la chaîne existante (validation des réponses, révélation, rapports, CSV) est réutilisée.
- Comptes, sessions hachées, en-tête anti-CSRF, limitation de débit : réutilisés pour l'administration.
- Lobby, QR, avatars, classement, podium animé, sons : réutilisés tels quels (thème appliqué par variables CSS).

## 7. Limitations actuelles

- Parties perdues si le processus redémarre (état et timers uniquement en mémoire).
- Une seule instance possible (la `Map` n'est pas partagée).
- Aucune notion d'administrateur ni de paramètres globaux ; identité « QuizBlitz » codée en dur.
- Pas de lecture de fichiers audio (uniquement de la synthèse), pas d'upload de médias.
- Interface en anglais.
- Pas d'en-têtes de sécurité (CSP, `X-Content-Type-Options`, etc.).
- Tests dépendants d'un serveur lancé manuellement ; pas de tests unitaires.

## 8. Risques de régression

| Risque | Mesure |
|---|---|
| Casser les 9 types de quiz | le blind test réutilise le type `quiz` ; les autres chemins ne sont pas modifiés ; tests e2e existants conservés |
| Casser la reconnexion | instantanés SSE inchangés, nouveaux champs ajoutés seulement |
| Changer le scoring | formule extraite à l'identique dans `lib/scoring.js` puis paramétrée ; tests unitaires |
| Thème illisible | couleurs validées (hex), contraste calculé pour le texte des boutons |

## 9. Incompatibilités avec Vercel (vérification précise)

| Question | Réponse |
|---|---|
| Le serveur actuel peut-il être déployé tel quel sur Vercel ? | **Non.** `http.createServer().listen()` n'existe pas en serverless ; il faudrait l'envelopper dans une fonction, mais tout le reste casse (voir ci-dessous). |
| Les SSE actuels sont-ils compatibles ? | Une fonction Vercel peut streamer, mais sa durée est plafonnée (quelques minutes selon le plan) et **chaque flux vit dans une instance différente** : un `push()` émis par l'instance qui reçoit la réponse d'un joueur n'atteint pas les flux ouverts dans les autres instances. |
| L'état des parties survit-il ? | **Non.** Variables globales perdues à chaque démarrage à froid et non partagées entre instances. |
| Plusieurs instances peuvent-elles gérer la même partie ? | Pas sans état externe (base/Redis) **et** bus de messages (Ably, Supabase Realtime, Redis pub/sub). |
| Les timers restent-ils fiables ? | **Non.** Un `setTimeout` meurt avec l'invocation ; il faut des transitions pilotées par horodatage (« lazy ») ou une file planifiée. |
| Deux requêtes successives sur deux instances ? | Oui, c'est le fonctionnement normal : d'où l'obligation d'un état externe. |
| Stocker les fichiers audio sur Vercel ? | Pas dans le système de fichiers (lecture seule, éphémère). Il faut un stockage objet (Vercel Blob, R2, S3, Supabase Storage). |
| Migrer vers Next.js ? | Pas nécessaire : Next.js ne résout ni l'état partagé ni le temps réel. Ce serait une réécriture complète du front sans gain fonctionnel. |
| Base externe nécessaire ? | Oui pour un déploiement 100 % serverless ; avec un backend persistant, SQLite sur volume suffit. |
| Service temps réel nécessaire ? | Oui pour du 100 % serverless (Ably / Supabase Realtime / Pusher) ; non avec un backend persistant. |
| Backend persistant externe préférable ? | **Oui pour une V1** (voir § 14). |

**Un simple `vercel.json` ne suffit pas.**

## 10. Risques liés au temps réel

- Coupures de flux SSE (veille du téléphone, proxy qui coupe les connexions longues) : atténuées par l'instantané complet à la reconnexion et `retry: 1500`.
- Proxys qui bufferisent (`X-Accel-Buffering: no` déjà présent) ; commentaires `keepalive` toutes les 20 s.
- Limite de 6 connexions HTTP/1.1 par domaine dans un même navigateur (un joueur qui ouvre beaucoup d'onglets) : sans impact en HTTP/2.

## 11. Risques liés à l'état en mémoire

- Redémarrage, redéploiement ou mise en veille de l'hébergeur (Render gratuit s'endort après 15 min) → parties perdues.
- Correction prévue : instantané de chaque partie écrit en base à chaque transition et restauré au démarrage, timers ré-armés depuis les horodatages persistés.

## 12. Références à « QuizBlitz » codées en dur

Identité visible par le public (à migrer vers la configuration) :

| Fichier | Ligne(s) | Contenu |
|---|---|---|
| `public/index.html` | 6, 12 | `<title>QuizBlitz</title>`, logo `Quiz<span>Blitz</span>` |
| `public/host.html` | 6, 106 | titre `Host · QuizBlitz`, logo |
| `public/play.html` | 7, 44, 56 | titre `Play · QuizBlitz`, logo (écran PIN et écran pseudo) |
| `public/library.html` | 6, 29, 46 | titre, logo, texte « this QuizBlitz server » |
| `public/reports.html` | 6, 53 | titre, logo |
| `server.js` | 422 | message d'erreur « …the computer that hosts QuizBlitz » |
| `server.js` | 439 | nom du fichier CSV `quizblitz-….csv` |
| `server.js` | 647 | log de démarrage |
| `public/play.html` | 6 | `theme-color` `#2b1a5e` (couleur de marque) |
| `public/style.css` | 1-22 | couleurs de marque en dur dans `:root` |

Identifiants techniques (non visibles, conservés pour compatibilité) : clés `localStorage`/`sessionStorage`
`quizblitz.*`, en-tête CSRF `X-QuizBlitz`, variable `QUIZBLITZ_DB`, nom du paquet npm, `render.yaml`.
Le README/EVIDENCE.md décrivent le projet d'origine : ce sont de la documentation, pas de l'identité applicative.

## 13. Stratégie de migration vers une identité dynamique

1. **Source unique** : table `app_settings` (une ligne JSON), valeurs par défaut dans `lib/settings.js`.
2. **Injection côté serveur** des pages HTML : le serveur remplace des marqueurs (`{{APP_NAME}}`, balise `<!--BRAND_HEAD-->`) par le nom, le favicon, les métadonnées Open Graph et un bloc `<style>` de variables CSS. Aucun flash de l'ancienne marque, et les aperçus de partage voient le bon nom.
3. **`/api/public/settings`** et le bloc JSON `#brand-data` (lu par `brand()` dans `shared.js`) pour les écrans dynamiques.
4. **Variables CSS** `--color-primary`, `--color-secondary`, `--color-accent`, `--color-background`, `--color-surface`, `--color-text`, `--color-text-muted`, `--button-radius`, reliées aux anciennes variables de `style.css`.
5. **Cache** : HTML en `no-cache` (revalidation à chaque visite), réglages publics `max-age=30`, médias immuables (nom de fichier aléatoire unique, donc un nouveau logo = une nouvelle URL).

## 14. Architecture cible recommandée

### Comparaison des options

| # | Option | Fonctionnement | Avantages | Inconvénients | Complexité | Coût | Temps réel / connexions | Multi-parties | Audio | Marque persistante | Maintenance | Dépendance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Adaptation minimale sur Vercel | `server.js` enveloppé dans une fonction | aucun nouveau service | **ne fonctionne pas** : état et timers perdus, SSE non partagés | faible | gratuit | cassé | non | non | non | – | Vercel |
| 2 | Next.js + Route Handlers | réécriture du front et des routes | écosystème Vercel | même problème d'état ; réécriture totale | élevée | gratuit à faible | nécessite quand même un service externe | non seul | non seul | non seul | élevée | Vercel |
| 3 | Vercel + Supabase | Postgres + Realtime + Storage | un seul fournisseur pour tout | réécriture complète en état externe, transitions « lazy », logique dans des fonctions courtes | élevée | gratuit puis 25 $/mois | Realtime (WebSocket) fiable | oui | Storage | Postgres | moyenne | Supabase |
| 4 | Vercel + Ably | Ably pour la diffusion, état ailleurs | temps réel de qualité | il faut encore une base ; jetons Ably à émettre | élevée | gratuit (quotas) | excellent | oui | non | non | moyenne | Ably + base |
| 5 | Vercel + Upstash Redis | état en Redis, polling ou pub/sub REST | serverless natif | pas de push serveur → polling ; timers à simuler | élevée | gratuit puis à l'usage | polling (latence ≈ 1 s) | oui | non | oui | moyenne | Upstash |
| 6 | Vercel + stockage objet | Blob/R2/S3 pour les médias | indispensable pour l'audio en serverless | ne règle que les médias | faible | quelques centimes/Go | – | – | oui | logos | faible | stockage |
| 7 | Vercel + backend Railway | front Vercel, `server.js` sur Railway avec volume | **réutilise le moteur existant**, SSE et timers natifs | un 2e service | faible | ≈ 5 $/mois | SSE natif | oui (une instance) | volume | SQLite sur volume | faible | Railway |
| 8 | Vercel + backend Render | idem sur Render | blueprint déjà présent | offre gratuite : disque éphémère + mise en veille ; disque persistant payant (≈ 7 $/mois) | faible | 0 (démo) / ≈ 7 $ | SSE natif | oui | disque payant | disque payant | faible | Render |
| 9 | Vercel + backend Fly.io | idem sur Fly avec volume | volume persistant, région Paris | CLI à installer, facturation à l'usage | moyenne | ≈ 2-5 $/mois | SSE natif | oui | volume | volume | faible | Fly.io |

### Choix retenu pour la V1

**Backend Node.js persistant (le serveur existant, enrichi) + frontend publié par Vercel en proxy.**

- Le moteur de jeu reste un serveur Node unique et autoritaire : SSE, timers et validation fonctionnent nativement, sans service temps réel tiers.
- **Aucun état critique uniquement en mémoire** : chaque partie est enregistrée en base (SQLite) à chaque transition, avec ses horodatages ; au redémarrage les parties actives sont restaurées et leurs timers ré-armés.
- Paramètres de marque, blind tests et médias sont en base et sur le volume persistant du backend.
- **Vercel** sert les pages et les fichiers statiques depuis son CDN, et redirige (`rewrites`) `/api/*`, `/media/*` et les pages HTML vers le backend : même origine, donc cookies `HttpOnly` de première partie, aucune configuration CORS. Si Vercel coupe un flux SSE long, `EventSource` se reconnecte et reçoit un instantané complet.
- Hébergeurs backend documentés : **Railway** (recommandé, volume simple), Fly.io, Render (avec disque payant). Le même dépôt fonctionne aussi seul, sans Vercel.

Pourquoi ne pas faire du 100 % Vercel dès maintenant : il faudrait réécrire tout le moteur en transitions sans état
(base externe + bus temps réel + stockage objet), soit trois fournisseurs supplémentaires et une logique de partie
beaucoup plus fragile. L'architecture retenue garde des **interfaces** (`lib/media.js` : pilote de stockage ;
`lib/gamestore.js` : persistance des parties) qui permettent cette évolution plus tard (voir `PLAN_EVOLUTION.md`).

Limite assumée : **une seule instance backend** à la fois (suffisant pour des centaines de joueurs et de nombreuses parties simultanées). La montée en charge horizontale passera par Redis pub/sub ou Ably.

## 15. Fichiers à créer ou modifier

| Fichier | Action |
|---|---|
| `lib/settings.js` | **nouveau** : modèle AppSettings, valeurs par défaut, validation, CSS de thème, injection HTML |
| `lib/blindtest.js` | **nouveau** : format `music-blind-test`, validation, conversion en questions de jeu |
| `lib/scoring.js` | **nouveau** : scoring extrait et paramétrable |
| `lib/media.js` | **nouveau** : abstraction de stockage, pilote disque local, contrôle des signatures |
| `lib/gamestore.js` | **nouveau** : sérialisation / restauration des parties |
| `db.js` | tables `app_settings`, `blind_tests`, `media`, `live_games`, colonne `role` |
| `server.js` | routes admin, réglages publics, médias, création de partie blind test, pause/reprise/reset, persistance |
| `public/admin.*`, `public/audio-player.js`, `public/home.js`, `views/` | **nouveaux** (les pages HTML passent de `public/` à `views/`) |
| `public/*.html`, `host.js`, `play.js`, `style.css` | marque dynamique, français, lecteur audio, écrans blind test |
| `vercel.json`, `.env.example`, `docs/*.md`, `test/*.test.js` | **nouveaux** |
