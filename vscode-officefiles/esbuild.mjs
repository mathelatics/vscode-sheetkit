// Standalone MCP builds for our agent surface. extension.js/.web.js are built by build.ts
// (reference-style, with the externalized node deps); this only produces the MCP entrypoints.
import { build, context as esbuildContext } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = { bundle: true, platform: 'node', target: 'node18', sourcemap: true, format: 'cjs', external: ['vscode'] };

const entries = {
  'src/host/mcp/standalone.ts': 'out/mcp-standalone.js',
  'src/host/mcp/ipcProxy.ts': 'out/mcp-ipc-proxy.js',
};

async function main() {
  if (watch) {
    const ctxs = await Promise.all(Object.entries(entries).map(([infile, outfile]) => esbuildContext({ ...common, entryPoints: [infile], outfile })));
    await Promise.all(ctxs.map(c => c.watch()));
    console.log('mcp watching');
  } else {
    await Promise.all(Object.entries(entries).map(([infile, outfile]) => build({ ...common, entryPoints: [infile], outfile })));
    console.log('mcp built');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
