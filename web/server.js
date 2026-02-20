const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── CSV Parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let i = 0;

  function parseField() {
    if (text[i] === '"') {
      i++;
      let val = '';
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') { val += '"'; i += 2; }
        else if (text[i] === '"') { i++; break; }
        else { val += text[i++]; }
      }
      return val;
    } else {
      let val = '';
      while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
        val += text[i++];
      }
      return val;
    }
  }

  function parseRow() {
    const fields = [];
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
      fields.push(parseField());
      if (text[i] === ',') i++;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    return fields;
  }

  while (i < text.length) {
    const row = parseRow();
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

// ─── Title cleaner ─────────────────────────────────────────────────────────────
// Filler words that signal the start of SEO padding in space-only titles
const SPACE_TITLE_STOPS = new Set([
  'sticker','stickers','decal','decals','vinyl','waterproof','holographic',
  'die-cut','die','cut','indoor','outdoor','laptop','bottle','skateboard',
  'merchandise','merch','accessories','accessory','gift','gifts','hunter',
  'breeds','nursery','literary',
]);

// Trailing product-type words to strip from the chosen segment
function stripTrailingType(seg) {
  // Strip 'Vinyl Sticker' / 'Vinyl Decal' — but keep if <= 3 words precede it
  const vinylStripped = seg.replace(/\s+vinyl\s+(sticker|decal)\s*$/i, '').trim();
  if (vinylStripped !== seg) {
    return vinylStripped.split(/\s+/).length <= 3 ? seg : vinylStripped;
  }
  // Strip lone 'Sticker' / 'Decal' — keep if < 2 words would remain, or if prior word is 'Vinyl'
  const typeStripped = seg.replace(/\s+(sticker|decal)\s*$/i, '').trim();
  if (typeStripped !== seg) {
    const remaining = typeStripped.split(/\s+/).length;
    if (remaining < 2) return seg;
    if (/\bvinyl\s*$/i.test(typeStripped)) return seg;
    return typeStripped;
  }
  return seg;
}

function makeTitle(raw) {
  // Split on comma / pipe / em-dash / en-dash
  const hasSep = /[,|–—]/.test(raw);

  let segments;
  if (hasSep) {
    segments = raw.split(/,|[|–—]/).map(s => s.trim()).filter(s => s.length > 2);
  } else {
    // Space-only title: walk words and stop at the first filler/repeated word
    const words = raw.split(/\s+/);
    let end = words.length;
    const seen = new Set();
    for (let i = 0; i < words.length; i++) {
      const w = words[i].toLowerCase().replace(/[^a-z]/g, '');
      // Stop at filler keyword (after at least 1 word collected)
      if (i >= 1 && SPACE_TITLE_STOPS.has(w)) { end = i; break; }
      // Stop on second occurrence of any meaningful word (SEO repetition)
      if (w.length > 3 && seen.has(w)) { end = i; break; }
      seen.add(w);
    }
    segments = [words.slice(0, Math.max(end, 2)).join(' ')];
  }

  // Score each segment — prefer shorter, non-filler segments
  const FILLER_PHRASES = [
    'laptop sticker','water bottle','waterproof','die-cut','die cut',
    'indoor outdoor','gift for','gifts for','vinyl sticker','vinyl decal',
  ];
  function score(seg) {
    const lower = seg.toLowerCase();
    const wc = seg.split(/\s+/).length;
    let s = 10;
    if (wc < 2) s -= 8;
    if (wc > 8) s -= (wc - 8) * 2;
    s -= FILLER_PHRASES.filter(f => lower.includes(f)).length * 3;
    return s;
  }

  const scored = segments.map((seg, i) => ({ seg, i, s: score(seg) }));
  const first = scored[0];
  const best = scored.slice().sort((a, b) => b.s - a.s)[0];
  // Prefer first segment unless another scores much higher AND first is very long
  const chosen = (best.s > first.s + 3 && first.seg.split(/\s+/).length > 8)
    ? best.seg
    : first.seg;

  // Second-pass: if the chosen segment is > 5 words, apply the same stop/dedup
  // logic used for space-only titles (handles long comma-segments like
  // "Forgiven Still Feral Raccoon Raccoon Vinyl Sticker")
  function trimLongSegment(seg) {
    const words = seg.split(/\s+/);
    if (words.length <= 5) return seg;
    let end = words.length;
    const seen = new Set();
    for (let i = 0; i < words.length; i++) {
      const w = words[i].toLowerCase().replace(/[^a-z]/g, '');
      if (i >= 1 && SPACE_TITLE_STOPS.has(w)) { end = i; break; }
      if (w.length > 3 && seen.has(w)) { end = i; break; }
      seen.add(w);
    }
    return words.slice(0, Math.max(end, 2)).join(' ');
  }

  let title = stripTrailingType(trimLongSegment(chosen));

  // Hard cap at 48 chars at a word boundary
  if (title.length > 48) {
    title = title.substring(0, 45).replace(/\s+\S+$/, '').trimEnd() + '…';
  }

  // Strip trailing dangling prepositions / conjunctions / articles left by truncation
  title = title.replace(/\s+(for|and|or|the|a|an|of|is|in|at|by|to|with|but|as|from|on|still|no|such)\s*$/i, '').trim();

  return title;
}

// ─── Load Products ─────────────────────────────────────────────────────────────
function loadProducts() {
  const csvPath = path.join(__dirname, '..', 'sticker-products.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCSV(content);
  const headers = rows[0];

  const products = [];
  for (let r = 1; r < rows.length; r++) {
    const row = {};
    headers.forEach((h, idx) => { row[h] = (rows[r][idx] || '').trim(); });

    // Skip rows with no title or price
    if (!row['TITLE'] || !row['PRICE']) continue;

    // Collect image URLs (non-empty)
    const images = [];
    for (let n = 1; n <= 10; n++) {
      const img = (row[`IMAGE${n}`] || '').trim();
      if (img) {
        // Ensure full URL — some rows may have truncated URLs
        images.push(img.startsWith('http') ? img : null);
      }
    }
    const validImages = images.filter(Boolean);
    if (validImages.length === 0) continue;

    // Parse tags
    const rawTags = row['TAGS'] || '';
    const tags = rawTags
      .split(',')
      .map(t => t.trim().replace(/_/g, ' '))
      .filter(Boolean);

    const rawTitle = row['TITLE'];
    const cleanTitle = makeTitle(rawTitle);
    const titleLower = rawTitle.toLowerCase();
    const tagsLower  = tags.map(t => t.toLowerCase());

    // Assign product-type category (priority order matters)
    let category;
    if (titleLower.includes('magnetic bookmark') || tagsLower.some(t => t.includes('magnetic bookmark'))) {
      category = 'Magnetic Bookmarks';
    } else if (titleLower.includes('bookmark') || tagsLower.some(t => t.includes('bookmark'))) {
      category = 'Bookmarks';
    } else if (titleLower.includes('notepad') || tagsLower.some(t => t.includes('notepad'))) {
      category = 'Notepads';
    } else {
      category = 'Stickers';
    }

    products.push({
      id: r,
      title: cleanTitle,
      fullTitle: rawTitle,
      description: row['DESCRIPTION'] || '',
      price: parseFloat(row['PRICE']) || 0,
      currency: row['CURRENCY_CODE'] || 'USD',
      tags,
      images: validImages,
      category,
    });
  }

  return products;
}

const PRODUCTS = loadProducts();
console.log(`Loaded ${PRODUCTS.length} products`);

// ─── Product-type categories ───────────────────────────────────────────────────
// Category is pre-assigned on each product in loadProducts().
const CATEGORY_LABELS = ['Stickers', 'Bookmarks', 'Magnetic Bookmarks', 'Notepads'];

const ALL_TAGS = CATEGORY_LABELS.map(label => ({
  tag: label,
  count: PRODUCTS.filter(p => p.category === label).length,
})).filter(c => c.count > 0);

// ─── HTTP Server ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── API routes ────────────────────────────────────────────────────────────────
  if (pathname === '/api/products') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const tag    = (url.searchParams.get('tag')    || '').toLowerCase();
    const page   = parseInt(url.searchParams.get('page') || '1', 10);
    const limit  = parseInt(url.searchParams.get('limit') || '24', 10);
    const sort   = url.searchParams.get('sort') || 'default';

    let results = PRODUCTS;

    if (search) {
      results = results.filter(p =>
        p.title.toLowerCase().includes(search) ||
        p.tags.some(t => t.toLowerCase().includes(search))
      );
    }

    if (tag) {
      // Match against the pre-assigned product category (case-insensitive)
      results = results.filter(p => p.category.toLowerCase() === tag.toLowerCase());
    }

    if (sort === 'price-asc')  results = [...results].sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') results = [...results].sort((a, b) => b.price - a.price);

    const total = results.length;
    const start = (page - 1) * limit;
    const items = results.slice(start, start + limit);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total, page, limit, items }));
    return;
  }

  if (pathname === '/api/tags') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ALL_TAGS.map(({ tag, count }) => ({ tag, count }))));
    return;
  }

  if (pathname.startsWith('/api/product/')) {
    const id = parseInt(pathname.replace('/api/product/', ''), 10);
    const product = PRODUCTS.find(p => p.id === id);
    if (!product) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(product));
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────────
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);

  if (!ext && !pathname.startsWith('/api')) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nSticker shop running at http://localhost:${PORT}\n`);
});
