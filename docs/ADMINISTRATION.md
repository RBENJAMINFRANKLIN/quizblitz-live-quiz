# Administration

Adresse : **`/admin`** (non référencée par les moteurs de recherche, inaccessible sans connexion).

## Compte administrateur

Le compte est créé ou mis à jour au démarrage du backend à partir des variables d'environnement :

```
ADMIN_EMAIL=vous@exemple.fr
ADMIN_PASSWORD=une-phrase-de-passe-longue-et-unique
```

- Changer `ADMIN_PASSWORD` puis redémarrer **réinitialise** le mot de passe et déconnecte les sessions existantes.
- En local sans `ADMIN_PASSWORD`, un mot de passe aléatoire est généré **une seule fois** et affiché dans la console (`admin@example.com` par défaut).
- En production sans `ADMIN_PASSWORD`, aucun compte n'est créé (avertissement dans les logs).
- Le mot de passe est haché (scrypt) ; il n'apparaît jamais dans le code envoyé au navigateur.

Sécurité de session : cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production, expiration après 12 h
(`ADMIN_SESSION_HOURS`), déconnexion explicite, 5 tentatives de connexion max par 15 min et par IP, message
d'erreur identique quel que soit le champ erroné.

## Navigation

| Menu | Rôle |
|---|---|
| **Tableau de bord** | nombre de blind tests et de morceaux, parties en cours, joueurs connectés, historique récent, avertissements de configuration, accès rapides |
| **Blind tests › Tous** | liste (actifs / archivés) : lancer, modifier, dupliquer, exporter JSON, archiver, supprimer (avec confirmation) |
| **Blind tests › Nouveau** | éditeur |
| **Blind tests › Importer** | import d'un fichier JSON validé avant import, ou du blind test de démonstration |
| **Parties › En cours** | PIN, état, joueurs connectés ; reprendre l'animation, terminer, supprimer |
| **Parties › Historique** | rapports des parties terminées (`/reports`) : scores, réponses par joueur, export CSV |
| **Médias** | fichiers audio, images et logos, favicons : téléverser, écouter / voir, copier l'URL, supprimer (refusé si le fichier est utilisé) |
| **Paramètres › Général** | nom, nom court, slogan, organisateur, texte d'accueil, texte du QR code, langue |
| **Paramètres › Apparence** | logos, favicon, image d'accueil, couleurs, thème, arrondi, aperçu, restauration |
| **Paramètres › Jeu** | expiration des parties, joueurs max, rejoindre en cours de partie, joueurs déconnectés, barème des points |

## Éditeur de blind test

- Titre, description, réglages (compte à rebours, durée d'extrait par défaut, rejoindre en cours, changement de réponse, mélange des propositions).
- Manches : ajouter, renommer, choisir le type de question, réordonner (↑ ↓), supprimer.
- Morceaux : ajouter (un par un ou **plusieurs fichiers audio d'un coup** — le nom « Artiste - Titre.mp3 » préremplit les champs), modifier, dupliquer, réordonner, supprimer.
- Par morceau : titre, artiste, année, fichier ou URL audio (téléversement direct), pochette, début et durée de l'extrait, type de question, question personnalisée, 4 propositions avec bouton radio pour la bonne réponse, difficulté, notes internes.
- **Préécoute** : écouter l'extrait au bon point avec arrêt automatique, pause, reprise, recommencer, arrêter ; « Début ici » fixe le début à la position en cours ; ±5 s pour ajuster.
- **Validation en continu** : bonne réponse absente des propositions, doublons, champs manquants, fichier audio inaccessible. Enregistrement refusé tant qu'il reste une erreur.
- **Brouillon** : chaque modification est sauvegardée localement ; si vous quittez sans enregistrer, le brouillon est proposé à la réouverture. Un avertissement apparaît avant de quitter la page.

## Lancer et animer une partie

1. **Blind tests › ▶ Lancer** : la partie est créée et l'écran animateur s'ouvre (à afficher sur le vidéoprojecteur).
2. Lobby : nom et logo, titre du blind test, QR code (`/play?pin=…`, le PIN est pré-rempli), adresse, PIN, joueurs. Verrouiller / déverrouiller, retirer un joueur.
3. **Lancer ▶** (ce clic autorise aussi le son dans le navigateur).
4. Barre de commandes en bas de l'écran : état courant, joueurs connectés / inscrits, réponses reçues, état du temps réel, erreurs audio ; **Pause / Reprendre**, **Relancer** (reprend le morceau au compte à rebours, réponses de ce morceau annulées), **Son** (coupe le son localement), **Révéler** (ferme les réponses), **volume**, **Débloquer** (renvoie l'état et relance les minuteurs, ne supprime rien), **Terminer** (avec confirmation). « ☰ » réduit la barre.
5. Après la révélation : **Classement ▶**, puis **◀ Masquer** ou **Morceau suivant ▶**. À la fin : podium animé et lien vers le rapport.

Si l'onglet animateur est rafraîchi, la partie reprend où elle en était ; un bouton « Activer le son et reprendre » apparaît (règle d'autoplay des navigateurs). Si l'onglet a été fermé : **Parties › En cours › Reprendre l'animation**.

> L'écran animateur est aussi l'écran projeté : il n'affiche jamais le titre du morceau suivant. Pour vérifier vos morceaux, utilisez l'éditeur sur un autre appareil.
