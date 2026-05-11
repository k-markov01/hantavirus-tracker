const express = require('express');
const path = require('path');
const { buildFallbackOutbreakData, fetchOutbreakData } = require('./parser');

const app = express();
const PORT = process.env.PORT || 3000;

let cache = {
  data: null,
  fetchedAt: null,
  ttlMs: 30 * 60 * 1000,
};

app.use(express.static(path.join(__dirname, '../public')));

app.get('/assets/world/countries-110m.json', (req, res) => {
  try {
    const atlasPath = require.resolve('world-atlas/countries-110m.json');
    res.sendFile(atlasPath);
  } catch (error) {
    res.status(404).json({ error: 'world-atlas not installed. Run: npm install world-atlas' });
  }
});

app.get('/api/outbreak', async (req, res) => {
  try {
    const now = Date.now();

    if (!cache.data || !cache.fetchedAt || now - cache.fetchedAt > cache.ttlMs) {
      console.log('[cache] MISS - fetching fresh WHO data...');
      cache.data = await fetchOutbreakData();
      cache.fetchedAt = now;
    } else {
      console.log('[cache] HIT');
    }

    res.json({ ok: true, fetchedAt: new Date(cache.fetchedAt).toISOString(), ...cache.data });
  } catch (error) {
    console.error('[api/outbreak] error:', error.message);
    res.status(500).json({ ok: false, error: error.message, fallback: buildFallbackOutbreakData() });
  }
});

app.post('/api/outbreak/refresh', async (req, res) => {
  try {
    console.log('[refresh] forcing fresh WHO fetch...');
    cache.data = await fetchOutbreakData();
    cache.fetchedAt = Date.now();
    res.json({ ok: true, fetchedAt: new Date(cache.fetchedAt).toISOString(), ...cache.data });
  } catch (error) {
    console.error('[api/outbreak/refresh] error:', error.message);
    res.status(500).json({ ok: false, error: error.message, fallback: buildFallbackOutbreakData() });
  }
});

app.listen(PORT, () => {
  console.log(`WHO Hantavirus Tracker running at http://localhost:${PORT}`);
});
