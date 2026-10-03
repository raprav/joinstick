import os from 'node:os';

const VIRTUAL = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|wg|zt|bridge|vethernet|virtualbox|vmware|hyper-v)/i;

// Prefer typical home/office ranges: 192.168/16, then 10/8, then 172.16/12.
function rank(ip) {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const [a, b] = ip.split('.').map(Number);
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return 3;
}

function skipped(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** LAN IPv4 addresses phones can likely reach, best candidate first. */
export function lanAddresses() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || skipped(a.address)) continue;
      found.push({ name, address: a.address });
    }
  }
  return found.sort((x, y) => rank(x.address) - rank(y.address));
}

export function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0' || hostname.startsWith('127.');
}
