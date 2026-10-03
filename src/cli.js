#!/usr/bin/env node
import http from 'node:http';
import { parseArgs } from 'node:util';
import { attach } from './server.js';
import { lanAddresses } from './lan.js';

const HELP = `Usage: joinstick [options]

Turn phones into gamepads for browser games.

Options:
  --port <n>          Port to listen on (default: $PORT or 3000)
  --static <dir>      Also serve this directory (your game) on the same port
  --public-url <url>  Base URL phones should open, e.g. https://abc.trycloudflare.com
                      (default: $PUBLIC_URL, else the detected LAN address)
  -h, --help          Show this help
`;

let args;
try {
  args = parseArgs({
    options: {
      port: { type: 'string' },
      static: { type: 'string' },
      'public-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  }).values;
} catch (err) {
  console.error(`${err.message}\n\n${HELP}`);
  process.exit(1);
}
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const port = Number(args.port ?? process.env.PORT ?? 3000);
const publicUrl = args['public-url'] ?? process.env.PUBLIC_URL;
const server = http.createServer();
attach(server, { static: args.static, publicUrl });

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try --port ${port + 1}` : err.message);
  process.exit(1);
});

server.listen(port, () => {
  const lan = lanAddresses();
  const base = publicUrl?.replace(/\/+$/, '') ?? (lan[0] ? `http://${lan[0].address}:${port}` : `http://localhost:${port}`);
  console.log(`Joinstick listening on http://localhost:${port}`);
  if (lan.length) {
    console.log('LAN addresses:');
    for (const a of lan) console.log(`  ${a.address.padEnd(15)} ${a.name}${a === lan[0] && !publicUrl ? '  <- used for join links' : ''}`);
  } else {
    console.log('No LAN address found: phones can only join with --public-url.');
  }
  console.log(`Phones join at: ${base}/j`);
  console.log(`Host SDK:       http://localhost:${port}/joinstick/host.js`);
  if (args.static) console.log(`Game:           http://localhost:${port}/  (serving ${args.static})`);
});
