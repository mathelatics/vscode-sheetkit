// Dual build like vscode-office (build.ts) but simpler: esbuild for host + MCP standalone; vite for webview.
import { build, context as esbuildContext } from 'esbuild';

const watch = process.argv.includes('--watch');

const common = { bundle: true, platform: 'node', target: 'node18', sourcemap: true, format: 'cjs', external: ['vscode'] };

async function main() {
  if (watch) {
    const ctxs = await Promise.all([
      esbuildContext({ ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' }),
      esbuildContext({ ...common, entryPoints: ['src/host/mcp/standalone.ts'], outfile: 'out/mcp-standalone.js' }),
    ]);
    await Promise.all(ctxs.map(c => c.watch()));
    console.log('host watching');
  } else {
    await Promise.all([
      build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' }),
      build({ ...common, entryPoints: ['src/host/mcp/standalone.ts'], outfile: 'out/mcp-standalone.js' }),
    ]);
    console.log('host built');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
