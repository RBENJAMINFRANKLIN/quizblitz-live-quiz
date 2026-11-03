# QuizBlitz

A live, multiplayer quiz game in the style of Kahoot. The host shows questions on a big screen;
players join on their phones by **scanning a QR code or typing a 6-digit game PIN**.

- **9 question types:** Quiz, True or false, Type answer, Slider, Puzzle, Drop pin, Poll, Word cloud, Open-ended
- **Music and sound effects:** lobby music, question music that speeds up near the buzzer, ticks, gong, drumroll and fanfare
- **Per-question points:** standard, double or none
- **Game options:** random question and answer order, lock the game when it starts, friendly nickname generator, classic mode
- **Nickname safety:** blocks offensive names in English, Hindi (Devanagari) and Hinglish
- **Host accounts and an online quiz library**, plus **game reports** with CSV export

No npm dependencies: just **Node.js 22.13 or newer** (it uses Node's built-in SQLite).

## Demo

**[▶ Watch a 2-minute game with every question type (MP4)](docs/media/quizblitz-all-types.mp4)**, recorded from the
app running locally. The host screen is on the left and one player's phone is on the right.

[![Host lobby with game PIN, QR code and players](docs/media/02-host-lobby.png)](docs/media/quizblitz-all-types.mp4)

**Question types on the big screen**

| Type answer | Slider | Puzzle |
|---|---|---|
| ![Typed answers with correct ones ticked](docs/media/r2-reveal-fixed.png) | ![Number line with the correct value](docs/media/r3-reveal-fixed.png) | ![Correct order revealed](docs/media/r4-reveal.png) |
| **Drop pin** | **Word cloud** | **Puzzle (while open)** |
| ![Pins on the image and the correct area](docs/media/r5-reveal.png) | ![Word cloud of answers](docs/media/r7-reveal.png) | ![Shuffled puzzle items](docs/media/h4-question-fixed.png) |

**On the phone**

| Type answer | Slider | Puzzle | Drop pin | Wrong, with the answer | Poll / word cloud |
|---|---|---|---|---|---|
| ![Text answer](docs/media/p2-typeanswer.png) | ![Slider](docs/media/p3-slider.png) | ![Reorder items](docs/media/p4-puzzle.png) | ![Tap the image](docs/media/p5-droppin.png) | ![Incorrect, showing the correct answer](docs/media/p6-result-wrong-with-answer.png) | ![Neutral thank-you screen](docs/media/p8-result-neutral.png) |

**Hosting, accounts and safety**

| Editor with question types | Game options | Quiz library |
|---|---|---|
| ![Editor with type, time and points menus](docs/media/e0-editor-top.png) | ![Game options](docs/media/e2-options.png) | ![Library of saved quizzes](docs/media/l1-library.png) |
| **Locked lobby** | **Nickname generator** | **Offensive nickname blocked** |
| ![Lobby locked](docs/media/h0-lobby-locked.png) | ![Random friendly nickname with spin button](docs/media/p1-name-generator.png) | ![Hindi slur rejected](docs/media/p0-name-blocked.png) |

**Classic screens:** [editor](docs/media/01-host-editor.png) · [question](docs/media/08-host-question.png) ·
[reveal](docs/media/12-host-reveal.png) · [scoreboard](docs/media/15-host-scoreboard.png) · [podium](docs/media/18-host-podium.png) ·
phone [join](docs/media/04-phone-nickname.png), [avatar](docs/media/05-phone-avatar.png), [answer](docs/media/09-phone-answer.png),
[correct](docs/media/13-phone-correct.png), [wrong](docs/media/14-phone-wrong.png), [final](docs/media/19-phone-final.png)

**Game reports**

| Summary | Players | Questions |
|---|---|---|
| ![Report summary](docs/media/21-report-summary.png) | ![Per-player answers](docs/media/22-report-players.png) | ![Per-question breakdown](docs/media/23-report-questions.png) |

## Run it

```bash
npm start            # or: node server.js
```

Then on the computer that will be the big screen, open **http://localhost:3000/host**.

1. Build a quiz (or click **Load sample quiz**, which uses every question type), set **⚙️ Game options**, then click **Host live game**.
2. Players on the **same Wi-Fi** scan the QR code, or go to the address shown and enter the PIN.
3. Click **Start** when everyone's in. Use **Next** to move from answers to scoreboard to the next question.

> Windows may ask whether Node.js may accept network connections. Allow it on
> **private networks**, or phones won't be able to connect.
> To use a different port: `$env:PORT=8080; npm start` (PowerShell).

## Question types

| Type | Players… | Scoring |
|---|---|---|
| **Quiz** | pick one of 2-4 answers (one or more can be correct) | speed points |
| **True or false** | pick True or False | speed points |
| **Type answer** | type the answer; up to 4 accepted spellings, capitals, accents and spaces ignored | speed points |
| **Slider** | pick a number on a slider; correct within a margin you set | speed points, less the further off |
| **Puzzle** | put 3-4 shuffled items in the right order | speed points if the order is exactly right |
| **Drop pin** | tap a spot on an image; correct inside the area you marked | speed points |
| **Poll** | vote; there is no right answer | no points |
| **Word cloud** | type a word or two; answers form a word cloud | no points |
| **Open-ended** | type a longer answer (120 characters), shown on screen | no points |

**Points per question:** *Standard*, *Double* (2×, shown as "2× points" on screen) or *No points*.
A correct answer earns up to 1000 points, falling linearly to 500 at the buzzer, plus +100 per answer
streak after the first (up to +500). Answer times are measured on the server, so a phone's clock can't affect speed points.

Images can be any `https://` link or a file served by QuizBlitz (put it in `public/` and use e.g. `/sample/solar-system.svg`,
which the sample drop-pin question uses).

## Game options

| Option | What it does |
|---|---|
| Randomise question order | Questions come in a random order |
| Randomise answer order | Quiz and poll answers are shuffled |
| Friendly nickname generator | Players get a random name like *BraveOtter* and can spin 3 times; typed names are not allowed |
| Lock the game when it starts | Nobody new can join after the first question (on by default). The host can also **🔒 Lock / Unlock** the lobby any time |
| Show questions and answers on players' devices | Turn off for classic mode: phones show only the coloured shapes |

## Music and sounds

All music and sound effects are **original and synthesised live in the browser** (Web Audio API), so there are no audio
files to download. Kahoot's own recordings are copyrighted, so QuizBlitz recreates the feel instead:

- **Host screen:** upbeat lobby music; a pop when each player joins; get-ready beeps; tense question music that speeds up
  and ticks in the last 5 seconds; a gong at time-up; a reveal whoosh; a scoreboard sting; a drumroll, fanfare and applause on the podium.
- **Phones:** a jingle for correct, a buzz for wrong and a friendly chime for polls and word clouds.
- **🔊 / 🔇** buttons on the host screen and the phone footer turn sound on and off (remembered per device).

Browsers only allow sound after a click, so the host's sound starts when you click **Host live game**.

## Nickname safety

Nicknames are checked against English, Hindi (Devanagari) and Hinglish (romanised Hindi) offensive words, including
common disguises such as `f.u.c.k`, `fuuuck`, `sh1t`, spaced-out letters and words hidden inside longer names.
Short words are matched only as whole words, so names like *Kshitij*, *Chhota*, *Assam* or *Scunthorpe* are allowed.
The same filter hides offensive word-cloud and open-ended answers from the big screen. You can add words in `filter.js`.

## Host accounts and quiz library

Open **📚 My library** to create an account (name, email, password) or sign in.

- **💾 Save to library** in the editor saves the quiz to your account; saving again updates it.
- The library lists your quizzes with their question types and how many times each was played, with **▶ Host**,
  **✏️ Edit**, **⧉ Duplicate**, **🗑 Delete** and search.
- Reports of games you host while signed in belong to your account and can be opened from any device that reaches
  your QuizBlitz server.

"Online" means stored on the computer or server running QuizBlitz: on your own PC, the library is on your PC; deploy
QuizBlitz to a server to reach it from anywhere. Passwords are hashed with scrypt; sessions use an HttpOnly cookie.

## Reports (game history)

Every game that reaches the podium (or is ended early with **End**) is saved. Open **📊 Reports**, or **View report**
on the podium screen:

- **Summary:** % correct, players, average score, podium, **difficult questions** (fewer than 35% correct), players who
  **need help** (fewer than 35% correct) and players who **didn't finish**.
- **Players:** rank, score, correct/unanswered, and each answer with points and time.
- **Questions:** per type: answer splits, typed answers, slider average, puzzle and pin success, word-cloud words.
- **Download CSV** (opens in Excel or Google Sheets) and **Delete**.

Signed-in hosts see their own reports. Games hosted without an account are visible only on the computer running
QuizBlitz (or anywhere with `REPORTS_KEY`, see below).

## Where data lives

- **Live games:** in memory while they run; restarting the server ends a game in progress.
- **Accounts, libraries and reports:** `data/quizblitz.db` (SQLite: one file, nothing to install). Back it up by
  copying the file. Older databases are upgraded automatically.
- **The quiz you're editing:** saved in the host's browser as a draft, and can be exported or imported as JSON.

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `QUIZBLITZ_DB` | `data/quizblitz.db` | Database file |
| `REPORTS_KEY` | (none) | Lets no-account reports be opened remotely with `/reports?key=…` |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |

## Project layout

```
server.js          game server: state machine, timers, scoring, accounts, library, reports API, SSE
questions.js       question types: validation, what phones see, scoring, reveal summaries
filter.js          nickname/text filter (English, Hindi, Hinglish) and the nickname generator
db.js              SQLite storage: users, sessions, quizzes, game history
public/host.*      quiz editor, game options, lobby (PIN + QR), host game screens, podium
public/play.*      player phone screens for every question type
public/library.*   sign in / register and the quiz library
public/reports.*   reports page (summary, players, questions, CSV)
public/sound.js    synthesised music and sound effects
public/shared.js   API, clock-sync and DOM helpers
public/sample/     image used by the sample drop-pin question
EVIDENCE.md        how this design was derived from analysing Kahoot's player app
```

## Tests

With the server running (`npm start`), run `npm test`. It runs two API test suites:

- `test/e2e.js`: a 3-player game: speed scoring, streaks, rejoining and the saved report.
- `test/features.js`: every question type (answers never leak to phones, correct scoring), double and no points,
  lobby lock, nickname filter and generator, accounts, the quiz library and report privacy between accounts.

## Not built yet

Team mode, player reactions/emotes, self-paced "assign" homework mode and public quiz discovery.
