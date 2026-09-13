# Pong — Sundai Hack #140

A 9 × 17 Pong game for the MIT Green Building simulator used at Sundai Hack #140.

- Display: 9 pixels wide × 17 pixels high
- Paddles: 3 pixels wide, top and bottom
- Ball: 1 pixel
- Default simulator instance: `mellow-heron`
- Matches are first to 5 points
- Only one browser controls the game at a time
- Python version is included for terminal/autoplay use

## Public web version

GitHub Pages:

`https://xandercogan.github.io/pong-hack-sundai140/`

Controls:

- Top paddle: `A` / `D`
- Bottom paddle: `←` / `→`
- On-screen controls are also available

Both paddles begin under AI control. The first human input for a paddle permanently hands that paddle to the human for that match.

A match ends immediately when either side reaches 5 points. The current public fallback then releases control so another browser can take over.

Building viewer:

`https://sundai.willsarg.com/mellow-heron`

## FIFO queue backend

The repository also contains `server/server.js`, a queue/lease service designed to sit between GitHub Pages and the Sundai frame endpoint.

When that backend is deployed and `window.PONG_CONTROL_API` is configured on the GitHub page, the browser automatically switches to true FIFO queue mode:

1. The first visitor gets the controller.
2. Later visitors receive numbered queue positions.
3. The active match ends at 5 points.
4. If anyone is waiting, the finished player moves to the back of the queue and the next waiting player is promoted automatically.
5. If nobody is waiting, the same player immediately starts another first-to-5 match.
6. Closed/disconnected waiting tabs expire from the queue automatically.

Until a queue backend URL is configured, the public page deliberately falls back to the simpler one-controller lease using the simulator's live-frame timestamp. That fallback is not a strict ordered queue.

## Queue server configuration

The queue service expects:

- `SUNDAI_FRAME_URL=https://sundai.willsarg.com/api/i/mellow-heron/frame`
- `ALLOWED_ORIGIN=https://xandercogan.github.io`

Optional:

- `LEASE_MS` (default `8000`)
- `WAITING_TTL_MS` (default `15000`)

The included `railway.toml` starts `server/server.js` and checks `/health`.

## Python version

```bash
python3 pong.py mellow-heron
```

The Python script uses only the standard library and posts JSON frames to the simulator API.

## Upstream simulator

Built against:

https://github.com/willsarg/sundai-greenbuilding-sim
