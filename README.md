# QuizBlitz

A live, multiplayer quiz game. The host shows questions on a big screen; players join
on their phones by **scanning a QR code or typing a 6-digit game PIN**.

No npm dependencies: just **Node.js 22.13 or newer** (it uses Node's built-in SQLite for game history).

## Demo

**[▶ Watch an 80-second game (MP4)](docs/media/quizblitz-demo.mp4)**: a real 3-player game recorded from the app
running locally. The host screen is on the left and one player's phone is on the right.

[![Host lobby with game PIN, QR code and three players](docs/media/02-host-lobby.png)](docs/media/quizblitz-demo.mp4)

**Host screen (big screen or projector)**

| Quiz editor | Question with live timer |
|---|---|
| ![Quiz editor with the sample quiz](docs/media/01-host-editor.png) | ![Question screen with timer and answer count](docs/media/08-host-question.png) |
| **Answer reveal** | **Animated podium** |
| ![Answer distribution with the correct answer highlighted](docs/media/12-host-reveal.png) | ![Podium with avatars, scores and confetti](docs/media/18-host-podium.png) |

The scoreboard after each question is in [docs/media/15-host-scoreboard.png](docs/media/15-host-scoreboard.png).

**Player phone**

| Join | Pick an avatar | Answer | Correct | Wrong | Final place |
|---|---|---|---|---|---|
| ![Nickname entry](docs/media/04-phone-nickname.png) | ![Avatar picker](docs/media/05-phone-avatar.png) | ![2x2 answer buttons](docs/media/09-phone-answer.png) | ![Correct answer with points and rank](docs/media/13-phone-correct.png) | ![Wrong answer screen](docs/media/14-phone-wrong.png) | ![Final rank and score](docs/media/19-phone-final.png) |

**Game reports (history)**

| Summary | Players | Questions |
|---|---|---|
| ![Report summary: accuracy, podium, difficult questions, players who need help](docs/media/21-report-summary.png) | ![Per-player results with each answer](docs/media/22-report-players.png) | ![Per-question answer split, % correct and average time](docs/media/23-report-questions.png) |

## Run it

```bash
npm start            # or: node server.js
```

Then on the computer that will be the big screen, open **http://localhost:3000/host**.

1. Edit the quiz (or keep the sample), then click **Host live game**.
2. Players on the **same Wi-Fi** scan the QR code, or go to the address shown and enter the PIN.
3. Click **Start** when everyone's in. Use **Next** to move from answers to scoreboard to the next question.

> Windows may ask whether Node.js may accept network connections. Allow it on
> **private networks**, or phones won't be able to connect.
> To use a different port: `$env:PORT=8080; node server.js` (PowerShell).

## How a round works

| Phase | Host screen | Phone |
|---|---|---|
| Lobby | PIN, QR code, players joining | "You're in!" |
| Get ready (4 s) | Question text and countdown | Countdown |
| Question | Question, answers, timer, answer count | Coloured shape buttons |
| Reveal | Answer distribution and correct answer | Correct/Incorrect, points, streak, rank |
| Scoreboard | Top 5 | Your place |
| End | Podium and full leaderboard | Final place and score |

**Scoring:** a correct answer earns up to 1000 points, falling linearly to 500 at the
buzzer. Each consecutive correct answer after the first adds +100, up to +500.
Answer times are measured on the server, so a phone's clock can't affect speed points.

**Avatars:** every player gets their own animal character when they join, and can
change it (character and accessory) from the lobby. Avatars appear in the lobby,
scoreboard and podium.

**Podium:** the end screen reveals 3rd, then 2nd, then a drumroll and spotlight, then
1st with confetti, followed by the rest of the leaderboard. Use **Replay podium** to
show it again.

**Question images:** each question can have an optional image link, which is shown
in the middle of the host screen.

**Reports (game history):** every game that reaches the podium (or is ended early with
**End**) is saved. Open **📊 Reports** in the editor, or **View report** on the podium screen:

- **Summary:** % correct answers, players, average score, the podium, **difficult questions**
  (fewer than 35% correct), players who **need help** (fewer than 35% correct) and players
  who **didn't finish**.
- **Players:** rank, score, correct/unanswered, and each player's answer, points and time per question.
- **Questions:** answer split per option, % correct and average answer time.
- **Download CSV** (opens in Excel or Google Sheets) and **Delete**.

Reports are private to the host: they open only on the computer running QuizBlitz, not on
players' phones. When hosting online, set `REPORTS_KEY` and open `/reports?key=YOUR_KEY`.

Players who refresh or whose phone sleeps rejoin automatically. The host can remove a
player by clicking ✕ on their name in the lobby.

## Project layout

```
server.js          game server: state machine, timers, scoring, REST + SSE
db.js              game history in SQLite (Node's built-in node:sqlite)
public/reports.*   reports page (summary, players, questions, CSV)
data/quizblitz.db  the database file, created on first run (not committed)
public/index.html  landing page (enter PIN)
public/host.*      quiz editor, lobby (PIN + QR), host game screens
public/play.*      player phone screens
public/shared.js   API, clock-sync and DOM helpers
public/style.css   shared styles
EVIDENCE.md        how this design was derived from analyzing Kahoot's player app
```

**Where data lives**

- **Live games** are kept in memory while they run; restarting the server ends a game in progress.
- **Finished games** are saved to `data/quizblitz.db` (SQLite: a single file, nothing to install).
  Back it up by copying the file; delete it to clear all history. Change the location with
  `QUIZBLITZ_DB=/path/to/file.db`.
- **Quizzes** are saved in the host browser's local storage, and can be exported or imported
  as JSON:

```json
{ "title": "My quiz",
  "questions": [ { "text": "2 + 2 = ?", "choices": ["3", "4"], "correct": [1], "time": 20 } ] }
```

## Tests

With the server running (`npm start`), run `npm test`. It plays a full 3-player game through the
API and checks scoring, streaks, rejoining, and the saved report (stats, CSV, privacy, delete).
