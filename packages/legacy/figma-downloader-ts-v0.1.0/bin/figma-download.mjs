#!/usr/bin/env node
// figma-download — CLI entrypoint. Thin shebang wrapper around src/cli.mjs.
import { run } from '../src/cli.mjs';

run(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    process.stderr.write(`[figma-download] error: ${err?.message || err}\n`);
    process.exit(1);
  });
