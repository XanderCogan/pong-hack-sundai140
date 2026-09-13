#!/usr/bin/env python3
"""Upload a persistent AI-vs-AI Pong clip to mellow-heron.

The simulator plays this clip whenever no live game frames have arrived for ~2 seconds.
No third-party dependencies are required.
"""

import random
import urllib.request

W, H, PADDLE = 9, 17, 3
FPS = 8
FRAME_COUNT = 240
INSTANCE = "mellow-heron"
CLIP_URL = f"https://sundai.willsarg.com/api/i/{INSTANCE}/clip"

TOP = (0, 170, 255)
BOTTOM = (255, 120, 0)
BALL = (255, 255, 255)
BLACK = (0, 0, 0)

random.seed(140)

top_x = bottom_x = 3
ball_x, ball_y = 4, 8
dx, dy = 1, 1


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def track(x, target):
    center = x + 1
    if target < center:
        x -= 1
    elif target > center:
        x += 1
    return clamp(x, 0, W - PADDLE)


def bounce_dx(hit, paddle, current):
    center = paddle + 1
    if hit < center:
        return -1
    if hit > center:
        return 1
    return current or 1


def frame_bytes():
    out = bytearray(H * W * 3)

    def put(y, x, rgb):
        i = (y * W + x) * 3
        out[i:i+3] = bytes(rgb)

    for x in range(top_x, top_x + PADDLE):
        put(0, x, TOP)
    for x in range(bottom_x, bottom_x + PADDLE):
        put(H - 1, x, BOTTOM)
    put(ball_y, ball_x, BALL)
    return bytes(out)


frames = []
for _ in range(FRAME_COUNT):
    # Strong but slightly imperfect AI so the animation remains Pong-like.
    if dy < 0 or random.random() < 0.2:
        top_x = track(top_x, ball_x)
    if dy > 0 or random.random() < 0.2:
        bottom_x = track(bottom_x, ball_x)

    nx, ny = ball_x + dx, ball_y + dy
    if nx < 0 or nx >= W:
        dx *= -1
        nx = ball_x + dx

    if ny <= 0:
        if top_x <= nx < top_x + PADDLE:
            dy = 1
            dx = bounce_dx(nx, top_x, dx)
            ball_x, ball_y = nx, 1
        else:
            ball_x, ball_y = 4, 8
            dx, dy = random.choice((-1, 1)), 1
    elif ny >= H - 1:
        if bottom_x <= nx < bottom_x + PADDLE:
            dy = -1
            dx = bounce_dx(nx, bottom_x, dx)
            ball_x, ball_y = nx, H - 2
        else:
            ball_x, ball_y = 4, 8
            dx, dy = random.choice((-1, 1)), -1
    else:
        ball_x, ball_y = nx, ny

    frames.append(frame_bytes())

# Binary clip wire format: magic 'C', fps, frame count little-endian, then raw RGB frames.
payload = bytes((0x43, FPS, FRAME_COUNT & 0xFF, FRAME_COUNT >> 8)) + b"".join(frames)
req = urllib.request.Request(
    CLIP_URL,
    data=payload,
    method="POST",
    headers={
        "Content-Type": "application/octet-stream",
        "User-Agent": "pong-hack-sundai140/1.0",
    },
)

with urllib.request.urlopen(req, timeout=20) as response:
    if response.status not in (200, 201):
        raise SystemExit(f"clip upload failed: HTTP {response.status}")
    print(f"Uploaded {FRAME_COUNT} Pong frames at {FPS} FPS to {INSTANCE}")
