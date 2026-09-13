#!/usr/bin/env python3
"""Autoplay 9x17 Pong on a Sundai Green Building simulator instance."""
import argparse, json, random, time, urllib.request

W,H,P=9,17,3
TOP=[0,170,255]; BOTTOM=[255,120,0]; BALL=[255,255,255]

def clamp(n,a,b): return max(a,min(b,n))

def post_frame(url, frame):
    data=json.dumps(frame).encode()
    req=urllib.request.Request(url,data=data,headers={'Content-Type':'application/json','User-Agent':'pong-hack-sundai140/1'},method='POST')
    with urllib.request.urlopen(req,timeout=2) as r: r.read()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('instance',nargs='?',default='mellow-heron')
    ap.add_argument('--fps',type=float,default=8)
    args=ap.parse_args()
    url=f'https://sundai.willsarg.com/api/i/{args.instance}/frame'
    tx=bx=3; x,y=4,8; dx,dy=1,1
    print(f'Pong -> {args.instance}. Ctrl+C to stop.')
    try:
        while True:
            t=time.monotonic()
            def ai(px):
                c=px+1
                return clamp(px+(-1 if x<c else 1 if x>c else 0),0,W-P)
            if dy<0 or random.random()<.15: tx=ai(tx)
            if dy>0 or random.random()<.15: bx=ai(bx)
            nx,ny=x+dx,y+dy
            if nx<0 or nx>=W: dx*=-1; nx=x+dx
            if ny<=0:
                if tx<=nx<tx+P: dy=1; dx=-1 if nx<tx+1 else 1 if nx>tx+1 else dx; x,y=nx,1
                else: x,y,dx,dy=4,8,random.choice((-1,1)),1
            elif ny>=H-1:
                if bx<=nx<bx+P: dy=-1; dx=-1 if nx<bx+1 else 1 if nx>bx+1 else dx; x,y=nx,H-2
                else: x,y,dx,dy=4,8,random.choice((-1,1)),-1
            else: x,y=nx,ny
            f=[[[0,0,0] for _ in range(W)] for _ in range(H)]
            for px in range(tx,tx+P): f[0][px]=TOP
            for px in range(bx,bx+P): f[H-1][px]=BOTTOM
            f[y][x]=BALL
            try: post_frame(url,f)
            except Exception as e: print('send failed:',e)
            time.sleep(max(0,1/args.fps-(time.monotonic()-t)))
    except KeyboardInterrupt: pass

if __name__=='__main__': main()
