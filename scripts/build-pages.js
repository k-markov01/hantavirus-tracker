const fs = require('fs');
const path = require('path');
const { buildFallbackOutbreakData, fetchOutbreakData } = require('../server/parser');

const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');
const distDir = path.join(repoRoot, 'dist');
const distApiDir = path.join(distDir, 'api');
const distAtlasDir = path.join(distDir, 'assets', 'world');

async function main() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distApiDir, { recursive: true });
  fs.mkdirSync(distAtlasDir, { recursive: true });

  fs.cpSync(publicDir, distDir, { recursive: true });

  const atlasSource = require.resolve('world-atlas/countries-110m.json');
  fs.copyFileSync(atlasSource, path.join(distAtlasDir, 'countries-110m.json'));

  let outbreakPayload;
  try {
    const outbreakData = await fetchOutbreakData();
    outbreakPayload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      ...outbreakData,
    };
  } catch (error) {
    const fallback = buildFallbackOutbreakData();
    outbreakPayload = {
      ok: true,
      fetchedAt: new Date().toISOString(),
      ...fallback,
      isFallback: true,
      buildError: error.message,
    };
  }

  fs.writeFileSync(
    path.join(distApiDir, 'outbreak.json'),
    `${JSON.stringify(outbreakPayload, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

  console.log(`GitHub Pages artifact written to ${distDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
