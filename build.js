#!/usr/bin/env node
/*
 * Build: src/shell.html + src/app.jsx  ->  index.html (+ "Habit Tracker.html")
 *
 * Why this exists: the app used to ship JSX in a <script type="text/babel"> block and
 * compile it in the browser via Babel Standalone — a 3.1MB blocking download plus a full
 * transpile of the whole app before anything could render, paid by every visitor on every
 * page load. Compiling once here removes both.
 *
 * There is still no bundler and no server-side build: index.html remains a single
 * self-contained static file that Vercel serves as-is. This just runs before committing.
 *
 * Usage:  node build.js        (from habit-tracker/)
 */
const babel = require('@babel/core');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/* React + framer-motion + supabase-js, bundled to one same-origin file.
 * Previously fetched at runtime as ~196 ES modules from esm.sh + one from unpkg. */
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/vendor.js')],
  outfile: path.join(ROOT, 'vendor.js'),
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2019'],
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
});
console.log(`built vendor.js — ${fs.statSync(path.join(ROOT, 'vendor.js')).size} bytes`);
const jsx = fs.readFileSync(path.join(ROOT, 'src/app.jsx'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'src/shell.html'), 'utf8');

if (!shell.includes('<!--APP-->')) {
  console.error('src/shell.html is missing the <!--APP--> placeholder.');
  process.exit(1);
}

const { code } = babel.transformSync(jsx, {
  presets: [['@babel/preset-react', {
    runtime: 'classic',
    pragma: 'React.createElement',
    pragmaFrag: 'React.Fragment',
  }]],
  compact: false,
  comments: true,
  babelrc: false,
  configFile: false,
});

const indent = (s) => s.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n');

/* The app reads window.React / window.FramerMotion, which an ESM module script in <head>
 * assigns. Module scripts are deferred, so this classic inline script would otherwise run
 * FIRST and blow up on `const { useState } = React`. Gating on framer-ready (already the
 * app's own convention) keeps the ordering correct without an external file. */
const block = [
  '  <!-- App code: compiled from src/app.jsx by build.js. Do not edit by hand —',
  '       edit src/app.jsx and re-run `node build.js`. -->',
  '  <script>',
  '  (function () {',
  '    function __start() {',
  indent(code.replace(/\n+$/, '')),
  '    }',
  '    if (window.__framerReady) __start();',
  '    else window.addEventListener("framer-ready", __start, { once: true });',
  '  })();',
  '  </script>',
].join('\n');

const html = shell.replace('<!--APP-->', block);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
fs.writeFileSync(path.join(ROOT, 'Habit Tracker.html'), html); // kept-in-sync copy
console.log(`built index.html — ${html.length} bytes (app ${code.length} bytes, no Babel at runtime)`);
