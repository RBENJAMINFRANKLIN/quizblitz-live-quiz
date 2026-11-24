# Déploiement (Vercel + backend persistant)

> **Important.** Vercel seul ne suffit pas : ses fonctions serverless ne gardent ni l'état des parties, ni
> les minuteurs, ni les connexions temps réel entre deux requêtes (voir `ANALYSE_TECHNIQUE.md` § 9). Le
> moteur de jeu tourne donc sur un **backend Node.js persistant** avec un **disque persistant**, et Vercel
> sert le site et relaie les requêtes vers ce backend.

```
Joueurs / animateur / admin ──▶ https://votre-domaine.fr (Vercel)
                                    ├─ fichiers statiques (CDN Vercel)
                                    └─ pages, /api, /media ──proxy──▶ https://backend… (Railway / Fly / Render)
```

Ce document a été rédigé à partir de la configuration du dépôt ; le build Vercel (`npm run build`) a été
exécuté localement, mais **aucun déploiement réel n'a été effectué** depuis cet environnement. Faites un
test complet (étape 10) avant un événement.

## 1. Comptes nécessaires

| Service | Usage | Coût indicatif |
|---|---|---|
| GitHub | héberger le dépôt | gratuit |
| Vercel | frontend + proxy + domaine | gratuit (Hobby, usage non commercial) ou Pro 20 $/mois |
| **Un** hébergeur backend avec disque : Railway (recommandé), Fly.io ou Render | serveur Node + SQLite + médias | ≈ 5 $/mois (Railway), ≈ 2–5 $ (Fly), ≈ 7 $ + disque (Render Starter) |

Aucune base de données externe, aucun service temps réel tiers, aucune clé d'API n'est nécessaire.

## 2. Déployer le backend

### Option A — Railway (recommandé)

1. railway.app › **New Project › Deploy from GitHub repo** › choisir ce dépôt (le `Dockerfile` est détecté).
2. **Settings › Volumes › Add volume**, point de montage **`/data`** (1 Go suffit pour commencer).
3. **Variables** (voir § 4) : `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_URL`, `TRUST_PROXY=true`, `NODE_ENV=production`, `DATA_DIR=/data`.
4. **Settings › Networking › Generate Domain** → notez l'URL, par ex. `https://blindtest-production.up.railway.app`.
5. Vérifiez `https://…/api/health` → `{"ok":true,…}`.

### Option B — Fly.io

```bash
fly launch --no-deploy          # détecte le Dockerfile ; région cdg (Paris) conseillée
fly volumes create data --size 1 --region cdg
# dans fly.toml : [mounts] source = "data", destination = "/data" ; internal_port = 3000 ; min_machines_running = 1
fly secrets set ADMIN_EMAIL=… ADMIN_PASSWORD=… PUBLIC_URL=https://votre-domaine.fr
fly deploy
```

Gardez **une seule machine** (`fly scale count 1`) : l'application ne gère qu'une instance (voir ARCHITECTURE.md).

### Option C — Render

Le fichier `render.yaml` décrit un service **Starter avec disque** monté sur `/data` (le plan gratuit n'a pas
de disque : tout est perdu à chaque redémarrage, acceptable seulement pour une démo). **New › Blueprint**,
puis renseigner `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_URL`.

## 3. Créer le projet Vercel

1. vercel.com › **Add New › Project** › importer le dépôt GitHub.
2. Framework preset : **Other**. Laissez les commandes : `vercel.json` définit `npm run build`.
3. Variable d'environnement **`BACKEND_URL`** = l'URL https du backend (sans chemin ni `/` final).
4. **Deploy.**

Le build (`scripts/build-static.js`) produit `.vercel/output` (Build Output API v3) :
- `static/` : copie de `public/` servie par le CDN ;
- `config.json` : routes qui envoient `/`, `/host`, `/play`, `/admin`, `/library`, `/reports`, `/join/<pin>`, `/manifest.webmanifest`, `/api/*`, `/media/*` et les chemins inconnus vers `BACKEND_URL`.

Les pages passent par le backend pour que le nom, le logo, le favicon et les couleurs soient injectés côté
serveur : un changement dans l'admin est visible **sans nouveau build**. Si vous modifiez `BACKEND_URL`,
redéployez sur Vercel (c'est la seule valeur lue au build).

## 4. Variables d'environnement

Backend (voir `.env.example`) :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `ADMIN_EMAIL` | oui | identifiant administrateur |
| `ADMIN_PASSWORD` | oui | mot de passe administrateur (12 caractères minimum conseillés) |
| `DATA_DIR` | oui en production | dossier persistant (base + médias), ex. `/data` |
| `PUBLIC_URL` | conseillé | adresse publique utilisée dans les QR codes, ex. `https://blindtest.mondomaine.fr` |
| `NODE_ENV` | conseillé | `production` (active les cookies `Secure` par défaut) |
| `TRUST_PROXY` | oui derrière un proxy | `true` pour que la limitation de débit voie la vraie IP |
| `COOKIE_SECURE` | non | force `true`/`false` |
| `ADMIN_SESSION_HOURS` | non | durée de session admin (12 par défaut) |
| `ALLOW_PUBLIC_QUIZ_HOSTING` | non | `false` pour réserver l'éditeur de quiz classique aux comptes |
| `REPORTS_KEY` | non | clé de lecture des rapports de quiz classiques sans compte |
| `MEDIA_STORAGE` | non | `local` (seul pilote livré) |
| `PORT` | fourni par l'hébergeur | |

Vercel : `BACKEND_URL` uniquement.

## 5. Base de données et migrations

SQLite est créé automatiquement au premier démarrage dans `DATA_DIR/quizblitz.db`. Les migrations sont
appliquées automatiquement au démarrage (`db.js` : `CREATE TABLE IF NOT EXISTS` et ajout de colonnes), y
compris sur une base de l'ancienne version QuizBlitz. Aucune commande à lancer.

**Sauvegarde** : copiez `DATA_DIR` (base + dossier `media`) pendant que le service est arrêté, ou utilisez les
instantanés de volume de l'hébergeur.

## 6. Stockage des médias

Les fichiers téléversés vont dans `DATA_DIR/media` sur le volume du backend. 1 Go ≈ 200 extraits MP3 de
qualité moyenne. Prévoir plus si vous gardez les morceaux entiers. Pour un stockage objet (R2, S3, Blob,
Supabase), voir « Pilotes de stockage » dans `ARCHITECTURE.md`.

## 7. Temps réel

Rien à configurer : SSE natif. Derrière le proxy Vercel, si une connexion longue est coupée, le navigateur se
reconnecte en 1,5 s et reçoit un instantané complet (aucune perte d'état). Si vous constatez des
reconnexions fréquentes pendant une soirée, faites pointer un sous-domaine directement vers le backend
(par ex. `jeu.mondomaine.fr` → Railway) et utilisez-le comme `PUBLIC_URL` : c'est la configuration la plus robuste.

## 8. Déploiement et mises à jour

Chaque `git push` sur la branche de production redéploie Vercel et (si configuré) le backend. Le backend
écrit l'état des parties en base : un redéploiement pendant une partie la reprend au redémarrage (les
téléphones se reconnectent seuls). Évitez tout de même de déployer pendant un événement.

## 9. Domaine personnalisé et URL des QR codes

1. Vercel › Project › **Settings › Domains** › ajouter `blindtest.mondomaine.fr` et suivre les instructions DNS.
2. Mettre `PUBLIC_URL=https://blindtest.mondomaine.fr` sur le backend et redémarrer.
3. Le QR code du lobby pointe alors vers `https://blindtest.mondomaine.fr/play?pin=XXXXXX`.

Sans `PUBLIC_URL`, le QR code utilise l'adresse ouverte par l'animateur (ou l'IP Wi-Fi locale si l'animateur
est sur `localhost`).

## 10. Tests après déploiement

1. `https://votre-domaine/api/health` → `ok: true`.
2. `/admin` → connexion ; le tableau de bord ne doit pas afficher d'avertissement bloquant.
3. Paramètres › Général : changer le nom → recharger `/` dans une fenêtre privée → nouveau nom visible.
4. Apparence : téléverser un logo et un favicon → visibles sur `/`.
5. Importer le blind test de démonstration, le lancer, rejoindre avec 2 téléphones en 4G (pas seulement le Wi-Fi), jouer 2 morceaux jusqu'au podium.
6. Pendant un morceau, couper le Wi-Fi d'un téléphone 10 s → il se reconnecte et retrouve sa partie.
7. Redémarrer le backend pendant le lobby → la partie est toujours là.

## 11. Logs

- Railway : onglet **Deployments › View logs** ; Fly : `fly logs` ; Render : onglet **Logs**.
- Vercel : **Deployments › (déploiement) › Functions / Logs** (seulement le build et le routage : la logique est dans le backend).

## 12. Retour arrière (rollback)

- Vercel : **Deployments** › déploiement précédent › **Promote to Production**.
- Railway / Render : redéployer le déploiement précédent depuis l'historique ; Fly : `fly releases` puis `fly deploy --image <image précédente>`.
- La base est compatible ascendante (colonnes ajoutées, jamais supprimées). Avant une mise à jour majeure, sauvegardez `DATA_DIR`.

## 13. Limites des offres gratuites

- **Vercel Hobby** : usage non commercial, bande passante limitée (≈ 100 Go/mois), durée des requêtes relayées limitée (d'où les reconnexions SSE possibles).
- **Render Free** : pas de disque, mise en veille après 15 min (premier chargement ≈ 30 s) → démo uniquement.
- **Railway / Fly** : facturation à l'usage, pas de vraie gratuité permanente.

## 14. Droits des fichiers musicaux

Diffuser de la musique en public (soirée, bal, événement d'entreprise) relève en France de la **SACEM**
(déclaration et redevance), quel que soit le moyen de diffusion. Ne versez dans l'application que des fichiers
que vous avez le droit d'utiliser, et ne rendez pas les fichiers accessibles publiquement en dehors des parties.
Ce dépôt ne contient aucune musique protégée : les 3 extraits de démonstration sont des mélodies synthétisées
générées par `scripts/generate-demo-audio.js`.
