const { build } = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const result = await build({
    entryPoints: ['src/renderer.js'], bundle: true, platform: 'browser', format: 'iife',
    target: 'chrome150', outfile: 'dist/renderer.js', metafile: true, legalComments: 'eof'
  });
  const packages = new Set(Object.keys(result.metafile.inputs).filter(p => p.startsWith('node_modules/'))
    .map(p => p.split('/').slice(0, p.split('/')[1].startsWith('@') ? 3 : 2).join('/')));
  const notices = [];
  for (const directory of [...packages].sort()) {
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const license = await fs.readFile(path.join(directory, 'LICENSE'), 'utf8');
    notices.push(`${pkg.name} ${pkg.version} (${pkg.license})\n${license}`);
  }
  await fs.writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
