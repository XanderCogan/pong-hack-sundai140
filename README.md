# Pong — Sundai Hack #140

A 9 × 17 Pong game for the MIT Green Building simulator used at Sundai Hack #140.

- Display: 9 pixels wide × 17 pixels high
- Paddles: 3 pixels wide, top and bottom
- Ball: 1 pixel
- Default simulator instance: `mellow-heron`
- Browser version sends frames directly to the Sundai simulator API
- Python version is included for running the game from a terminal

## Web version

The site is designed to be served with GitHub Pages at:

`https://xandercogan.github.io/pong-hack-sundai140/`

After the repository is published with GitHub Pages, open the URL, press **Start**, and use:

- Top paddle: `A` / `D`
- Bottom paddle: `←` / `→`

There are also on-screen controls for touch devices and modes for local two-player, one-player vs AI, and AI demo.

The page sends 17 × 9 RGB frames to:

`https://sundai.willsarg.com/api/i/mellow-heron/frame`

and links to the building viewer at:

`https://sundai.willsarg.com/mellow-heron`

## Python version

```bash
python3 pong.py mellow-heron
```

The Python script uses only the standard library and posts JSON frames to the same API.

## Multiplayer

The current browser build supports **two players on the same computer/device**. True remote two-player needs a small realtime coordination service so two browsers share one authoritative game state; the Sundai simulator API exposes frame viewing/sending but not a separate player-input channel.

## Upstream simulator

Built against the interface and API documented in:

https://github.com/willsarg/sundai-greenbuilding-sim
