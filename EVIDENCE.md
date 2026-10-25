# How the Kahoot player quiz works — evidence

Captured 2026-10-25 with REA 6.7.0 from the public player app at `https://kahoot.it/`
(no account, no game PIN entered). Everything below is **static evidence from the shipped
JavaScript** plus one passive page load. No live game was joined, so nothing here
was observed *executing* during a quiz.

## Evidence records

| ID | What it is |
|---|---|
| `ev_8834f954…74ae6` | Browser capture of the join page: 39 requests, 27 console messages (Redux action log) |
| `ev_187807cf…eb269` | Full capture with response bodies (complete, nothing dropped) |
| `ev_1e662b0a…be275` | Script export of that capture: 15 scripts, including `controller-CjOeo165.js` (6.1 MB, sha256 `0ff337dd…cd98`) |

All code quotes below are from `controller-CjOeo165.js` unless noted. The bundle is not
minified (names such as `playerStates` and `gameSessionReducer` survive), so the
identifiers are Kahoot's own.

## 1. Architecture (observed)

- **React + Redux + redux-observable.** The page logs every Redux action with the epic
  that produced it, e.g. `features/login/game-id/INITIALIZE_GAME` → `initializeGameEpic`
  at `src/controller/features/login/redux/epics.ts:156`.
- **Real-time transport is CometD (Bayeux) over WebSocket**, with long-polling fallback
  (`Transport = { WebSockets: 'websocket', LongPolling: 'long-polling' }`). The CometD
  client lives in `app-DIQnlhRe.js`, including an **AckExtension** (guaranteed delivery)
  and a **TimeSyncExtension**, which measures network lag and clock offset to the server
  so every phone's countdown matches.
- **Channels:** `/service/controller` (player → game), `/service/player` (game → player),
  `/service/status`, `/controller/<gameId>`, plus moderator/speaker channels.
- **Joining:** `GET {reserve}/reserve/session/<PIN>/?<timestamp>` checks the PIN and returns a
  session token. The token is obfuscated (base64 + XOR with a server-supplied challenge)
  as an anti-bot measure. The client then publishes `{type:'login', gameid, name}` on
  `/service/controller`. Login errors include `NICKNAME_EXISTS`, `MAX_PLAYERS_REACHED`
  and `BOT_VALIDATION_FAILED`.

## 2. The game state machine (observed)

```js
playerStates = { PRE_QUIZ:0, QUIZ_STARTED:1, GET_READY:2, QUESTION_STARTED:3,
                 QUESTION_ENDED:4, SCOREBOARD:5, QUIZ_ENDED:6, GAME_PAUSED:11, ... }
```

On reconnect, the client switches on that state to restore the right screen, e.g.
`QUESTION_STARTED → answered ? ANSWER_SENT : GAME_BLOCK`, and
`QUESTION_ENDED → revealAnswer.hasAnswer ? ANSWER_RESULT : WAIT_FOR_NEXT_QUESTION`.

Player routes: `/` (PIN) → `/join` (nickname) → `/instructions` → `/start` →
`/getready` → `/gameblock` → `/answer/sent` → `/answer/result` → `/wait-for-next-question` → podium.

## 3. Message codes (observed: 155 definitions)

Host → player on `/service/player` (selected):

| Code | Action |
|---|---|
| 9 | `START_QUIZ` |
| 1 | `GET_READY` |
| 2 | `START_QUESTION` |
| 7 | `TIME_UP` |
| 8 | `REVEAL_ANSWER` |
| 13 | `REVEAL_RANKING` |
| 5 | `PLAY_AGAIN` |
| 10 | `RESET_CONTROLLER` |
| 14 | `USERNAME_ACCEPTED` |
| 17 | `SEND_RECOVERY_DATA_TO_CONTROLLER` |

Player → host on `/service/controller` (selected):

| Code | Action |
|---|---|
| **45** | **`GAME_BLOCK_ANSWER`** (the answer) |
| 6 | `POTENTIAL_GAME_BLOCK_ANSWER` |
| 16 | `REQUEST_RECOVERY_DATA_FROM_PLAYER` |
| 11 | `SUBMIT_FEEDBACK` |
| 47 / 48 | `SUBMIT_REACTION` / `SUBMIT_EMOTE` |

Every message is published as
`{ gameid, type: 'message', host, id: <code>, content: JSON.stringify(data) }`. The answer
payload is `gameBlockAnswer({ type, choice, questionIndex })`.

## 4. Scoring is server-side (observed)

The player client never computes points. On `QUESTION_ENDED` the reducer copies what the
server sends:

```js
let { hasAnswer, pointsData, nemesis, totalScore, rank, type, reactions, ...rest } = data
// -> state.totalScore, state.rank, result.answerStreakPoints = { streakLevel, previousStreakLevel }
```

So the server decides correctness, points, answer streaks, rank and the "nemesis" (the
player just ahead of you). Answer colours/shapes are indexed
`TRIANGLE:0, DIAMOND:1, CIRCLE:2, SQUARE:3`. Question types include `quiz`, `jumble`,
`survey`, `multiple_select_quiz`, `open_ended`, `word_cloud`, `slider` and `drop_pin`.

## 5. Inferences and unknowns

- **Unknown:** the exact points formula, which runs on Kahoot's servers. QuizBlitz uses the
  formula from Kahoot's public help pages (up to 1000 points, falling to 500 at the buzzer,
  plus a streak bonus). That is a design choice, not something observed in this code.
- **Unknown:** the host-screen ("player" app at `play.kahoot.it`) code. Only the phone
  controller was analyzed.
- **Not observed:** live WebSocket frames. Seeing those would mean joining a real game.

## How QuizBlitz maps to this

| Kahoot (observed) | QuizBlitz (this project) |
|---|---|
| CometD channels over WebSocket | Server-Sent Events down, `POST` up (no dependencies) |
| `/reserve/session/<PIN>` | `GET /api/games/<PIN>` |
| `login` publish + `NICKNAME_EXISTS` | `POST /api/games/<PIN>/join` with the same error codes |
| `playerStates` 0–6 | `LOBBY → GET_READY → QUESTION → REVEAL → SCOREBOARD → ENDED` |
| `GAME_BLOCK_ANSWER` (45) `{choice, questionIndex}` | `POST /api/games/<PIN>/answer {choice, questionIndex}` |
| Server-side `pointsData`, `rank`, `nemesis` | Server computes points, streak, rank and "behind X by N" |
| TimeSyncExtension | `serverNow` on every message gives the clock offset; timing is measured on the server |
| Recovery snapshot on reconnect | A state snapshot is pushed on every (re)connect |

QuizBlitz does **not** reuse any Kahoot code, assets, branding or the anti-bot token
scheme. It reimplements only the observed *behaviour*.
