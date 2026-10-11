"""Builds pitch/deck.html, an offline copy of the pitch deck, from the slide sources in
pitch/slides/ (the same files as the online Slides artifact). Run: python pitch/build-deck.py

Keys in the deck: arrows / space / click = next and previous, N = speaker notes, F = fullscreen.
Fonts load from Google Fonts when online and fall back to Georgia / Arial offline."""
import json, pathlib

here = pathlib.Path(__file__).parent
index = json.loads((here / 'slides' / 'deck.json').read_text(encoding='utf-8'))
sections = [(here / 'slides' / f'{sid}.html').read_text(encoding='utf-8') for sid in index['order']]
fonts = '&'.join(f['href'].split('?', 1)[1].replace('&display=swap', '') for f in index['faces'].values())

page = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Swissquote Wallet Pitch</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?__FONTS__&display=swap">
<style>
html, body { margin: 0; height: 100%; background: #0b1218; overflow: hidden; }
#stage { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1080px; transform-origin: 0 0; }
section { position: absolute; inset: 0; width: 1920px; height: 1080px; box-sizing: border-box; overflow: hidden; }
section:not(.on) { display: none !important; }
section *, section *::before, section *::after { box-sizing: border-box; margin: 0; }
section div { min-width: 0; }
section ul { padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.35em; }
section table { border-collapse: collapse; width: 100%; }
section th, section td { padding: 0.35em 0.6em; border-bottom: 1px solid #cfc9bd; text-align: left; vertical-align: top; }
section th { font-weight: 600; border-bottom: 2px solid #8f877a; }
section aside { display: none; }
section hr { border: 0; width: 100%; }
x-shape { display: block; flex: none; }
x-shape[kind="arrow-right"] { clip-path: polygon(0 32%, 58% 32%, 58% 0, 100% 50%, 58% 100%, 58% 68%, 0 68%); }
x-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; border: 3px solid currentColor; border-radius: 50%; font: 700 20px/1 Arial, sans-serif; }
x-icon[name="Check"]::before, x-icon[name="Verified"]::before { content: "\\2713"; }
x-icon[name="Warning"]::before { content: "!"; }
x-icon[name="Key"]::before { content: "1"; }
x-icon[name="Trust"]::before { content: "2"; }
x-icon[name="Lock"]::before { content: "3"; }
svg.wires { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; pointer-events: none; }
#notes { position: fixed; left: 0; right: 0; bottom: 0; max-height: 40%; overflow: auto; background: rgba(11,18,24,.94); color: #e6eaee; font: 18px/1.5 Arial, sans-serif; padding: 16px 24px; display: none; }
#count { position: fixed; right: 12px; top: 8px; color: #8fa1b0; font: 13px Arial, sans-serif; }
</style></head>
<body>
<div id="stage">
__SECTIONS__
</div>
<div id="notes"></div><div id="count"></div>
<script>
const slides = [...document.querySelectorAll('#stage > section')];
const stage = document.getElementById('stage');
const fit = () => {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s}) translate(-50%, -50%)`;
};
// Connectors: lines in slide coordinates, drawn into one SVG layer per slide.
for (const sec of slides) {
  const wires = sec.querySelectorAll('x-connector');
  if (!wires.length) continue;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'wires'); svg.setAttribute('viewBox', '0 0 1920 1080');
  wires.forEach((w, i) => {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(a => Number(w.getAttribute(a)));
    const color = w.style.color || '#14202B';
    const width = parseFloat(w.style.borderWidth) || 2;
    const dashed = (w.style.borderStyle || '').includes('dash');
    const head = w.getAttribute('head') || 'end';
    const route = w.getAttribute('route') || 'straight';
    const pts = route === 'vh' ? [[x1, y1], [x1, y2], [x2, y2]] : route === 'hv' ? [[x1, y1], [x2, y1], [x2, y2]] : [[x1, y1], [x2, y2]];
    const id = `m${slides.indexOf(sec)}_${i}`;
    const marker = document.createElementNS(NS, 'marker');
    marker.setAttribute('id', id); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5'); marker.setAttribute('orient', 'auto-start-reverse');
    const tip = document.createElementNS(NS, 'path'); tip.setAttribute('d', 'M0,0 L10,5 L0,10 z'); tip.setAttribute('fill', color);
    marker.appendChild(tip); svg.appendChild(marker);
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', pts.map(p => p.join(',')).join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', width);
    if (dashed) line.setAttribute('stroke-dasharray', `${width * 3} ${width * 2}`);
    if (head === 'end' || head === 'both') line.setAttribute('marker-end', `url(#${id})`);
    if (head === 'both') line.setAttribute('marker-start', `url(#${id})`);
    svg.appendChild(line);
    w.remove();
  });
  sec.appendChild(svg);
}
let i = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
const notes = document.getElementById('notes');
const show = n => {
  i = Math.max(0, Math.min(slides.length - 1, n));
  slides.forEach((s, k) => s.classList.toggle('on', k === i));
  notes.textContent = slides[i].querySelector('aside')?.textContent ?? '';
  document.getElementById('count').textContent = `${i + 1} / ${slides.length}`;
  history.replaceState(null, '', `#${i + 1}`);
};
addEventListener('keydown', e => {
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) show(i + 1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) show(i - 1);
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key.toLowerCase() === 'n') notes.style.display = notes.style.display === 'block' ? 'none' : 'block';
  else if (e.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
addEventListener('click', e => show(e.clientX > innerWidth / 3 ? i + 1 : i - 1));
addEventListener('resize', fit);
addEventListener('hashchange', () => show((parseInt(location.hash.slice(1), 10) || 1) - 1));
fit(); show(i);
</script>
</body></html>
"""
out = page.replace('__FONTS__', fonts).replace('__SECTIONS__', '\n'.join(sections))
(here / 'deck.html').write_text(out, encoding='utf-8')
print(f'pitch/deck.html: {len(sections)} slides')
