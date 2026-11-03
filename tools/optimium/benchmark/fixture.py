#!/usr/bin/env python3
"""Deterministic, offline single-origin browser memory workload."""
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import struct
import threading
import time
from urllib.parse import parse_qs, urlparse
import zlib


SPEC = {
    'name': 'optimium-local-dom-js-images-v2',
    'origin_count': 1,
    'dom_articles_per_tab': 1000,
    'retained_typed_array_bytes_per_tab': 1048576,
    'retained_objects_per_tab': 8000,
    'images_per_tab': 8,
    'image_width': 384,
    'image_height': 216,
    'retained_decoded_rgba_bytes_per_tab': 8 * 384 * 216 * 4,
    'decode_method': 'image load + synchronous canvas draw/readback; retained RGBA',
    'network': 'loopback only for workload; browser background services retain defaults',
}

PAGE = r'''<!doctype html>
<html lang="en"><meta charset="utf-8"><title>Memory fixture __TAB__</title>
<style>
html{color-scheme:light;background:#edf0f4;color:#19202a;font:16px sans-serif}
body{max-width:1080px;margin:32px auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between}
#images{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
img{width:100%;height:auto}article{display:grid;grid-template-columns:64px 1fr;
gap:12px;padding:12px;margin:8px 0;background:#fff;border-radius:8px}
h2,p{margin:0;font-size:16px}small{color:#48556a}
</style>
<header><h1>Deterministic workload</h1><output id="status">Loading</output></header>
<section id="images"></section><main id="rows"></main>
<script>
'use strict';
const tab=__TAB__;
const retained=new Uint8Array(1048576);
for(let i=0;i<retained.length;i++)retained[i]=(i*31+tab*17)&255;
const records=Array.from({length:8000},(_,i)=>({id:i,score:(i*17+tab)%997,
  title:`Record ${tab}:${i}`,tags:[`group-${i%23}`,`tag-${i%37}`]}));
window.fixtureRetained={retained,records};
const fragment=document.createDocumentFragment();
for(let i=0;i<1000;i++){
  const article=document.createElement('article');
  const number=document.createElement('span');number.textContent=String(i+1);
  const content=document.createElement('section');
  const title=document.createElement('h2');title.textContent=`Item ${tab}:${i}`;
  const body=document.createElement('p');body.textContent=
    'A fixed paragraph for measuring retained DOM, layout and text data.';
  const detail=document.createElement('small');detail.textContent=`Value ${(i*29)%997}`;
  content.append(title,body,detail);article.append(number,content);fragment.append(article);
}
document.querySelector('#rows').append(fragment);
const images=Array.from({length:8},(_,i)=>{
  const image=new Image(384,216);image.alt=`Fixture ${tab}:${i}`;
  image.loading='eager';image.src=`/asset/${tab}/${i}.png`;
  document.querySelector('#images').append(image);return image;
});
window.fixtureRetained.decodedPixels=[];
function loaded(image){
  return new Promise((resolve,reject)=>{
    if(image.complete){
      image.naturalWidth===384?resolve():reject(new Error('Invalid PNG dimensions'));
      return;
    }
    image.addEventListener('load',resolve,{once:true});
    image.addEventListener('error',()=>reject(new Error('PNG load failed')),{once:true});
  });
}
function decodeAllImages(){
  // image.decode() may wait for a rendering frame in a hidden document. A
  // synchronous canvas readback forces real decoding without activating tabs
  // or changing either browser's background scheduling flags.
  const canvas=document.createElement('canvas');canvas.width=384;canvas.height=216;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)throw new Error('No canvas context');
  images.forEach((image,index)=>{
    if(image.naturalWidth!==384||image.naturalHeight!==216)
      throw new Error('Invalid PNG dimensions');
    context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,384,216);
    const expected=[tab*19%256,index*23%256,(tab*7+index*13)%256,255];
    if(expected.some((value,channel)=>pixels.data[channel]!==value))
      throw new Error('Incorrect decoded PNG pixel');
    window.fixtureRetained.decodedPixels.push(pixels);
  });
}
async function report(kind){
  const payload={tab,articles:document.querySelectorAll('article').length,
    images:images.filter(image=>image.complete&&image.naturalWidth===384).length,
    jsBytes:retained.byteLength,objects:records.length,
    decodedBytes:window.fixtureRetained.decodedPixels.reduce((n,p)=>n+p.data.byteLength,0),
    visible:document.visibilityState,userAgent:navigator.userAgent};
  await fetch(`/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),cache:'no-store'});
}
Promise.all(images.map(loaded)).then(async()=>{
  decodeAllImages();
  // Geometry access forces DOM/style/layout work even in background tabs.
  window.fixtureRetained.layoutHeight=document.body.getBoundingClientRect().height;
  document.querySelector('#status').textContent='Ready';
  await report('ready');
  setInterval(()=>report('heartbeat').catch(()=>{}),10000);
}).catch(error=>{document.querySelector('#status').textContent=String(error);
  fetch('/failure',{method:'POST',body:JSON.stringify({tab,error:String(error)})});});
</script></html>'''


def png(tab, image):
    width, height = SPEC['image_width'], SPEC['image_height']
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(((x + tab * 19) % 256, (y + image * 23) % 256,
                        (x // 8 + y // 8 + tab * 7 + image * 13) % 256))

    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack(
            '!I', zlib.crc32(kind + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))


class FixtureServer:
    def __init__(self, tabs, log_path):
        self.tabs = tabs
        self.lock = threading.Lock()
        self.ready = {}
        self.heartbeat = {}
        self.failures = []
        self.requests = Counter()
        self.started = time.monotonic()
        self.log = Path(log_path).open('x', encoding='utf-8')
        # Generate once before launching a browser; this allocation is outside
        # its systemd cgroup and does not contribute to browser PSS.
        self.assets = {(tab, i): png(tab, i)
                       for tab in range(tabs) for i in range(8)}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status, body=b'', mime='text/plain'):
                self.send_response(status)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                parsed = urlparse(self.path)
                with outer.lock:
                    outer.requests[parsed.path] += 1
                    outer.event('get', {'path': self.path})
                if parsed.path == '/fixture':
                    try:
                        tab = int(parse_qs(parsed.query)['tab'][0])
                        if tab not in range(outer.tabs):
                            raise ValueError()
                    except (ValueError, KeyError, IndexError):
                        self.reply(400)
                        return
                    self.reply(200, PAGE.replace('__TAB__', str(tab)).encode(),
                               'text/html; charset=utf-8')
                elif parsed.path.startswith('/asset/'):
                    try:
                        parts = parsed.path.split('/')
                        data = outer.assets[(int(parts[2]), int(parts[3][:-4]))]
                        self.reply(200, data, 'image/png')
                    except (KeyError, ValueError, IndexError):
                        self.reply(404)
                else:
                    self.reply(404)

            def do_POST(self):
                try:
                    length = min(int(self.headers.get('Content-Length', '0')), 8192)
                    payload = json.loads(self.rfile.read(length))
                    tab = int(payload['tab'])
                    if tab not in range(outer.tabs):
                        raise ValueError('tab out of range')
                    with outer.lock:
                        outer.event(self.path, payload)
                        if self.path == '/failure':
                            outer.failures.append(payload)
                        elif self.path in ('/ready', '/heartbeat'):
                            expected = (1000, 8, 1048576, 8000, 8 * 384 * 216 * 4)
                            actual = tuple(payload.get(k) for k in
                                           ('articles', 'images', 'jsBytes', 'objects', 'decodedBytes'))
                            if actual != expected:
                                outer.failures.append({'tab': tab, 'incorrect_workload': payload})
                            else:
                                if self.path == '/ready':
                                    outer.ready[tab] = payload
                                outer.heartbeat[tab] = time.monotonic()
                        else:
                            self.reply(404)
                            return
                    self.reply(204)
                except (ValueError, KeyError, json.JSONDecodeError):
                    self.reply(400)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def event(self, kind, payload):
        self.log.write(json.dumps({'seconds': round(time.monotonic() - self.started, 3),
                                   'kind': kind, 'data': payload}) + '\n')
        self.log.flush()

    def urls(self):
        port = self.server.server_address[1]
        return [f'http://127.0.0.1:{port}/fixture?tab={tab}'
                for tab in range(self.tabs)]

    def snapshot(self):
        with self.lock:
            now = time.monotonic()
            return {'ready_tabs': sorted(self.ready), 'expected_tabs': self.tabs,
                    'ready_payloads': dict(self.ready),
                    'heartbeat_age_seconds': {str(k): round(now-v, 2)
                                               for k, v in self.heartbeat.items()},
                    'failures': list(self.failures), 'requests': dict(self.requests)}

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.log.close()
