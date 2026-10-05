#!/usr/bin/env node
import { readFileSync } from 'node:fs';
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
                      (default: $PUBLIC_URL, else the address the game page was
                      opened with, else the detected LAN address)
  --client-ip-header <name>
                      Header your reverse proxy sets to the visitor's address,
                      e.g. fly-client-ip or x-real-ip (default: $CLIENT_IP_HEADER).
                      Only behind a proxy that sets it: clients can fake it.
  -v, --version       Print the version
  -h, --help          Show this help
`;

let args;
try {
  args = parseArgs({
    options: {
      port: { type: 'string' },
      static: { type: 'string' },
      'public-url': { type: 'string' },
      'client-ip-header': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  }).values;
} catch (err) {
  console.error(`${err.message}\n\n${HELP}`);
  process.exit(1);
}
if (args.version) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  process.exit(0);
}
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const port = Number(args.port ?? process.env.PORT ?? 3000);
const publicUrl = args['public-url'] ?? process.env.PUBLIC_URL;
const server = http.createServer();
const clientIpHeader = args['client-ip-header'] ?? process.env.CLIENT_IP_HEADER;
attach(server, { static: args.static, publicUrl, clientIpHeader });

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
