# What I learned studying how a live quiz app works

QuizBlitz is an independent learning project. I looked at how the **public** player page of a
Kahoot-style quiz behaves (no account, no game joined), then designed and wrote everything here myself.
This file is my own summary of the ideas, not a copy of anyone's code.

## What I learned

1. **The server is the referee.** The phone only sends "I picked option 2". The server decides whether it
   was right, how many points it earned, the streak and the rank. Phones never calculate scores, so they can't cheat.
2. **The game is a state machine.** Lobby → get ready → question → reveal → scoreboard → podium. Every screen is
   a pure function of the current state, which is why a phone that reconnects can be put back on the right screen.
3. **Clocks can't be trusted.** Each phone measures its delay to the server so the countdown looks the same
   everywhere, and answer speed is timed on the server.
4. **Reconnects must be painless.** Phones lock, Wi-Fi drops. The server keeps each player's state and sends a
   fresh snapshot whenever someone reconnects.
5. **Answers must never leak.** What phones receive for a question never includes the correct answer; it only
   arrives at the reveal.

## What I could not know

- The exact points formula runs on their servers. QuizBlitz uses the formula from public help pages
  (up to 1000 points, falling to 500 at the buzzer, plus a streak bonus). That is a design choice.
- Anything about the host screen's internals or live traffic of a real game; I never joined one.

## How QuizBlitz does it

| Idea | QuizBlitz |
|---|---|
| Live updates to phones | Server-Sent Events down, plain `POST` up (no dependencies) |
| Game states | `LOBBY → GET_READY → QUESTION → REVEAL → SCOREBOARD → ENDED` |
| Server-side scoring | Points, streak and rank computed in `server.js` |
| Clock sync | `serverNow` on every message gives each phone its offset |
| Reconnect | A state snapshot is pushed on every (re)connect |

QuizBlitz uses **no** third-party code, assets, audio, branding or logos. Music and sounds are synthesised
in the browser. It is not affiliated with or endorsed by Kahoot!.
