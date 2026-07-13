# 👻 Tap the Ghost

A spooky whack-a-mole arcade game set around a haunted manor on a starry night. Creatures pop up in the windows — tap the bad ones, spare the good ones, and rack up the highest score before the timer (or your lives) run out.

**▶️ Play it live: [https://ivascaflavius.github.io/tap-the-ghost](https://ivascaflavius.github.io/tap-the-ghost)**

This is a web remake of *Zap the Ghost*, an Android game I built ~10 years ago with AndEngine (long since delisted). Same idea, new name, and no app store required — it runs in any modern browser on desktop, tablet, or phone.

## How to play

Creatures appear in the manor's windows one at a time, wait a moment for your reaction, then retreat.

| Action | Result |
|---|---|
| Tap a **bad guy** 👻 🧛 🐺 🎃 💀 😈 🧟 🧙 | **+3 points** |
| Let a bad guy escape untapped | **−1 point** |
| Tap a **good guy** 🐶 🐱 🐼 🐰 🦉 🐥 | **lose a life** 💔 |
| Let a good guy leave safely | **+1 point** |

You start with **3 lives** and a set timer. The game ends when the timer runs out or you lose all your lives.

### Difficulties

Lives and scoring are identical on every difficulty — what changes is the pace and the length of the round:

| Difficulty | Timer | Pace |
|---|---|---|
| Easy | 1:30 | Relaxed — creatures linger |
| Medium | 2:00 | Quicker spawns, shorter reaction window |
| Hard | 3:00 | Relentless — blink and they're gone |

Each difficulty has its own leaderboard, stored locally in your browser.

## Features

- 🏚️ Animated night scene — full moon, twinkling stars, flapping bats, drifting fog, chimney smoke, ivy-covered walls, and things with glowing eyes hiding in the bushes
- 🔊 Retro sound effects synthesized live with the Web Audio API (no audio files)
- 🏆 Per-difficulty highscore boards with player names, persisted in `localStorage`
- ⏸️ Pause menu — pauses automatically when you switch away from the window
- 📱 Fully responsive: works with mouse or touch on desktop, tablet, and phone
- 🚫 Zero dependencies, zero build step — plain HTML, CSS, and JavaScript

## Running locally

It's a static site, so any web server will do:

```sh
python -m http.server 4173
# then open http://localhost:4173
```

Or just open `index.html` directly in your browser.

## Tech

- Vanilla JavaScript (no frameworks, no libraries)
- Inline SVG scene with CSS animations
- Web Audio API for procedural sound effects
- `localStorage` for settings and leaderboards
