# Security policy

## Supported versions

Only the latest published release gets security fixes. While Joinstick is
0.x, fixes land in a new patch or minor release, not in older lines.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability
reporting: the **Security** tab of https://github.com/raprav/joinstick, then
**Report a vulnerability**. Include what you found, how to reproduce it and
the version you tested.

You should get a first answer within a week. Once a fix is released, the
advisory is published with credit to you unless you prefer otherwise.

## Scope and known limits

Joinstick is built for trusted local networks and games among friends. These
are known and documented, not vulnerabilities:

- Room codes are 4 letters and are the only thing needed to join a free slot.
- There is no user authentication or encryption beyond what you put in
  front of it (use HTTPS via a reverse proxy or tunnel on public networks).
- Per-address room limits see the proxy's address when behind a proxy.

Reports about crashing the server with crafted messages, reading files
outside the `--static` directory, script injection through layouts or
names, or taking over someone else's slot without its token are in scope.
