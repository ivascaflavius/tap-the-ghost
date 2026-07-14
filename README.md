# 👻 Tap the Ghost

A spooky whack-a-mole arcade game set around a haunted manor on a starry night. Creatures pop up in the windows — tap the bad ones, spare the good ones, and see how deep into the endless night you can survive.

**▶️ Play it live: [https://ivascaflavius.github.io/tap-the-ghost](https://ivascaflavius.github.io/tap-the-ghost)**

This is a web remake of *Zap the Ghost*, an Android game I built ~10 years ago with AndEngine (long since delisted). Same idea, new name, and no app store required — it runs in any modern browser on desktop, tablet, or phone.

## How to play

The night never ends. Creatures appear in the manor's windows one at a time, wait a moment for your reaction, then retreat — and the longer you survive, the faster they come. The game ends when you run out of lives.

| Action | Result |
|---|---|
| Tap a **bad guy** (ghost, vampire, werewolf, pumpkin, zombie, witch) | **+3 points** × combo |
| Let a bad guy escape untapped | **−1 point**, combo breaks |
| Let **3 bad guys escape in a row** | the ghosts overwhelm you — **lose a life** 💔 |
| Tap a **good guy** (dog, cat, rabbit, panda) | **lose a life** 💔, combo breaks |
| Let a good guy leave safely | **+1 point** |

You have **3 lives**.

### Combo

Consecutive bad-guy taps build a streak: **×2 points at 5**, **×3 at 10**. Missing a bad guy or tapping a good guy resets it.

### Rare visitors

- ✨ **Golden ghost** — +10 points (× combo), but it only lingers for a blink.
- ❤️ **Heart fairy** — tap her to win back a lost life (she visits at most 3 times a night, and only when a heart is missing).
- 💣 **Bomb** — looks tappable. Is not. Tapping it costs a life; let it fizzle out instead.

## Features

- 👻 Hand-drawn SVG characters — identical on every platform, no emoji lottery
- 🏚️ Living night scene — full moon, drifting clouds, lightning storms, flapping bats, a strolling roof cat, ivy-covered cracked walls, and things with glowing eyes in the bushes
- 🌘 The night visually deepens the longer you survive
- 🔊 All audio synthesized live with the Web Audio API — ambient wind, crickets, owl hoots, character voices, thunder — zero audio files
- 💥 Zap particles, screen shake, last-life heartbeat tension
- 📊 Lifetime stats (accuracy, best combo, longest night) and 9 unlockable badges
- 🏆 Local leaderboard with player names, persisted in `localStorage`
- 📳 Optional haptic feedback on supported devices (Android)
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
- Inline SVG scene and sprite sheet with CSS animations
- Web Audio API for procedural sound effects and ambience
- `localStorage` for settings, leaderboard, stats, and badges
