# Format « music-blind-test »

Un blind test est un document JSON. Exemple complet et valide : `public/exemples/blindtest-demo.json`
(importable en un clic depuis **Administration > Blind Tests > Importer**).

```json
{
  "id": "blindtest-annees-80",
  "type": "music-blind-test",
  "title": "Blind Test Années 80",
  "description": "30 morceaux emblématiques",
  "settings": {
    "answerMode": "multiple-choice",
    "countdownDuration": 3,
    "excerptDuration": 20,
    "revealDuration": 8,
    "scoreboardDuration": 8,
    "allowLateJoin": true,
    "allowAnswerChange": false,
    "playAudioOnHostOnly": true,
    "shuffleChoices": false
  },
  "rounds": [
    {
      "id": "round-1",
      "title": "Artistes",
      "questionType": "artist",
      "tracks": [
        {
          "id": "track-001",
          "title": "Je te donne",
          "artist": "Jean-Jacques Goldman",
          "year": 1985,
          "audioUrl": "/media/3f2a9c…e1.mp3",
          "coverUrl": "/media/77b0…c2.jpg",
          "startTime": 42,
          "duration": 20,
          "choices": ["Jean-Jacques Goldman", "Daniel Balavoine", "Michel Berger", "Francis Cabrel"],
          "correctAnswer": "Jean-Jacques Goldman",
          "difficulty": "medium",
          "notes": "Couplet 2"
        }
      ]
    }
  ]
}
```

## Champs

### Racine

| Champ | Obligatoire | Règle |
|---|---|---|
| `id` | non | lettres, chiffres, `-`, `_` ; généré s'il manque. À l'import, un `id` déjà existant est remplacé (jamais d'écrasement) |
| `type` | non | doit valoir `music-blind-test` s'il est présent |
| `title` | **oui** | 100 caractères max |
| `description` | non | 500 caractères max |

### `settings`

| Champ | Défaut | Règle |
|---|---|---|
| `answerMode` | `multiple-choice` | seul mode disponible en V1 (prévu : `free-text`, `buzzer`, `teams`) |
| `countdownDuration` | 3 | 0 à 10 s (minimum effectif 1 s pour précharger l'audio) |
| `excerptDuration` | 20 | 5 à 120 s, durée par défaut des morceaux |
| `revealDuration`, `scoreboardDuration` | 8 | 0 à 60 s (réservés à un futur enchaînement automatique ; en V1 l'animateur avance manuellement) |
| `allowLateJoin` | true | rejoindre une partie commencée |
| `allowAnswerChange` | false | si vrai, la dernière réponse envoyée avant la fermeture compte (le temps de réponse est celui de la dernière) |
| `playAudioOnHostOnly` | true | forcé à vrai : l'audio n'est jamais joué sur les téléphones |
| `shuffleChoices` | false | mélange l'ordre des propositions à chaque partie |

### Manche (`rounds[]`, 1 à 20)

| Champ | Règle |
|---|---|
| `id` | généré s'il manque |
| `title` | 80 caractères ; « Manche N » par défaut |
| `questionType` | `artist` (défaut), `title`, `year` ou `custom` : détermine la question affichée |
| `tracks` | au moins un morceau (150 morceaux max au total) |

### Morceau (`tracks[]`)

| Champ | Obligatoire | Règle |
|---|---|---|
| `title`, `artist` | **oui** | 120 caractères |
| `year` | non | entier 1800–2100 |
| `audioUrl` | **oui** | fichier téléversé `/media/<hex>.(mp3\|m4a\|ogg\|wav)`, fichier placé dans `public/audio/…`, ou lien `https://` |
| `coverUrl` | non | `/media/<hex>.(png\|jpg\|webp)`, `public/covers/…` ou `https://` ; montrée **uniquement** à la révélation |
| `startTime` | non | secondes (décimales autorisées), 0 par défaut |
| `duration` | non | 5 à 120 s ; c'est aussi le temps laissé pour répondre |
| `questionType` | non | remplace celui de la manche pour ce morceau |
| `question` | non | texte personnalisé (160 caractères) ; sinon « Qui interprète ce morceau ? », « Quel est le titre de ce morceau ? », « En quelle année est sorti ce morceau ? » |
| `choices` | **oui** | exactement 4 propositions non vides et distinctes (casse et accents ignorés pour la détection des doublons) |
| `correctAnswer` | **oui** | doit être l'une des 4 propositions, à l'identique |
| `difficulty` | non | `easy`, `medium`, `hard` |
| `notes` | non | notes internes, jamais envoyées aux écrans de jeu |

## Validation

- Côté serveur à chaque enregistrement et import (`POST /api/admin/blind-tests/validate` pour vérifier sans enregistrer). Les erreurs sont renvoyées avec leur chemin (`rounds[0].tracks[2].correctAnswer`) et affichées dans l'éditeur.
- Avertissements non bloquants : mode de réponse non disponible, URL audio externe semblant contenir la réponse.
- L'éditeur vérifie en plus que chaque fichier audio est lisible par le navigateur.

## Évolutions prévues par le modèle

Le modèle accueille déjà manches multiples, nombre variable de morceaux, pochette, début et durée par extrait,
type de question par manche ou par morceau. Les modes saisie libre, buzzer, équipes, réponses multiples
(artiste + titre) et questions bonus s'ajouteront par de nouvelles valeurs de `answerMode` / `questionType`
(voir `PLAN_EVOLUTION.md`).
