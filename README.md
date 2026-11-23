# TLV NONSTOP - תל אביב נון-סטופ

An original open-world city game set in Tel Aviv that runs in any browser with zero install, built in one evening at the Fable 5.2 Build Day (theme: accessibility).

- Drive, walk, missions, police "chaos meter", radio, day/night cycle.
- Accessibility menu (Tab): high contrast, colour-blind palettes, text size, sound captions with direction, screen-reader announcements, reduced motion, game speed, drive assist, one-handed mouse mode, story mode.
- AI assistant (T): type or speak Hebrew ("קח אותי לעזריאלי", "תגדיל את הטקסט", "מה יש סביבי?") and Claude controls the game through tools; talk to any pedestrian.

## Run

```
npm install
node serve.mjs 8080
```

Open http://127.0.0.1:8080/ . For the AI features put `ANTHROPIC_API_KEY=...` in a `.env` file next to `serve.mjs` (the key stays on the server; without it the game uses offline replies).

Built with three.js. Code written by Claude agents working in parallel; models, textures and music are the author's own generated assets.
