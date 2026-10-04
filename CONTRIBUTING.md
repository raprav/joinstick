# Contributing

Thanks for helping. Joinstick aims to stay **simple, fast and
self-hostable**: one Node process, two runtime dependencies (`ws`, `uqr`),
plain ES modules in the browser, no build step. Changes that keep it that way
are the easiest to merge; for anything bigger, open an issue first.

## Setup

```sh
git clone https://github.com/raprav/joinstick && cd joinstick
npm install
node src/cli.js --static examples/basic   # then open http://localhost:3000
npm test                                  # node:test, no extra tooling
```

Node 22 or newer. Tests must pass on Node 22 and the current release.

## Guidelines

- Add a test for new logic (`test/`). Pure pad geometry lives in
  `public/pad-layout.js` so it can be tested without a browser.
- Match the surrounding style: small functions, few comments that explain
  why, no new dependencies without a strong reason.
- Keep the pad game-agnostic: no game-specific buttons or behaviour.
- Public API or protocol changes update `README.md`, `AGENTS.md`,
  `PROTOCOL.md`, `llms.txt`, the `.d.ts` files and `CHANGELOG.md`.
- Test on a real phone when you touch the pad page, and say which one in the
  pull request.

By contributing you agree that your contributions are licensed under the MIT
license of this project.
