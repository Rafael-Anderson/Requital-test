// node compare.js <dirA> <dirB>  -> prints table of differing pixel counts (0 = identical)
const { chromium } = require('/home/user/Requital-test/e2e/node_modules/playwright');
const fs = require('fs');
const [A, B] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-proxy-server'] });
  const p = await b.newPage();
  const names = fs.readdirSync(A).filter((f) => f.endsWith('.png')).sort();
  const rows = [];
  for (const n of names) {
    if (!fs.existsSync(`${B}/${n}`)) { rows.push([n, 'MISSING in B']); continue; }
    const a = fs.readFileSync(`${A}/${n}`), c = fs.readFileSync(`${B}/${n}`);
    if (a.equals(c)) { rows.push([n, 0, 'bytes-identical']); continue; }
    const r = await p.evaluate(async ([x, y]) => {
      const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
      const [i1, i2] = await Promise.all([load(x), load(y)]);
      if (i1.width !== i2.width || i1.height !== i2.height) return { size: `${i1.width}x${i1.height} vs ${i2.width}x${i2.height}` };
      const mk = (i) => { const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const cx = cv.getContext('2d'); cx.drawImage(i, 0, 0); return cx.getImageData(0, 0, i.width, i.height).data; };
      const d1 = mk(i1), d2 = mk(i2); let n = 0, sig = 0, maxD = 0, sx0 = 1e9, sx1 = -1, sy0 = 1e9, sy1 = -1, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      for (let k = 0; k < d1.length; k += 4) if (d1[k] !== d2[k] || d1[k + 1] !== d2[k + 1] || d1[k + 2] !== d2[k + 2] || d1[k + 3] !== d2[k + 3]) { n++; const dd = Math.max(Math.abs(d1[k]-d2[k]), Math.abs(d1[k+1]-d2[k+1]), Math.abs(d1[k+2]-d2[k+2]), Math.abs(d1[k+3]-d2[k+3])); if (dd > maxD) maxD = dd; const px = (k / 4) % i1.width, py = Math.floor(k / 4 / i1.width); minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); if (dd > 2) { sig++; sx0 = Math.min(sx0, px); sx1 = Math.max(sx1, px); sy0 = Math.min(sy0, py); sy1 = Math.max(sy1, py); } }
      return { n, sig, maxD, bbox: n ? [minX, minY, maxX, maxY] : null, sbox: sig ? [sx0, sy0, sx1, sy1] : null };
    }, [a.toString('base64'), c.toString('base64')]);
    rows.push([n, r.size ? 'SIZE ' + r.size : r.n, r.size ? 'size' : 'maxDelta=' + r.maxD + ' sig(>2)=' + r.sig + (r.sbox ? ' sigbox=' + JSON.stringify(r.sbox) : ''), r.bbox ? JSON.stringify(r.bbox) : 'decoded-identical']);
  }
  for (const r of rows) console.log(r.join('\t'));
  const zero = rows.filter((r) => r[1] === 0).length;
  const size = rows.filter((r) => typeof r[1] === 'string').length;
  const sigRows = rows.filter((r) => typeof r[2] === 'string' && /sig\(>2\)=[1-9]/.test(r[2])).length;
  console.log(`TOTAL ${rows.length} compared, ${zero} identical (0 differing px), ${size} different size, ${sigRows} with significant (>2 level) pixel diffs, ${rows.length - zero - size - sigRows} differing only by <=2-level antialiasing noise`);
  await b.close();
})();
