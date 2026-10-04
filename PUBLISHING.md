# Publishing checklist

For the maintainer. Steps that need the npm or GitHub account, in order.
Nothing here is automated until step 4 is done.

## 0. Check the release locally

```sh
git switch main && git pull
npm ci && npm test
npm pack --dry-run            # only src/, public/, docs .md files, LICENSE, package.json
```

Set the date of the release in `CHANGELOG.md` (`## [0.1.0] - YYYY-MM-DD`)
and commit.

## 1. Make the GitHub repository public

Settings → General → Danger Zone → Change visibility → Public. README
images load from `raw.githubusercontent.com`, so they only render (on GitHub
and on npm) once the repository is public.

Then in Settings:

- **General**: Description: `Use phones as gamepads for browser games. Scan a
  QR, play. Self-hosted, no accounts, no app install.` Website:
  `https://www.npmjs.com/package/joinstick`. Social preview: upload
  `docs/social.png` (1280x640).
- **Topics**: `gamepad`, `controller`, `phone-controller`,
  `mobile-controller`, `local-multiplayer`, `party-game`, `couch-coop`,
  `qr-code`, `websocket`, `html5-game`, `browser-game`, `self-hosted`,
  `nodejs`.
- **Code security**: enable *Private vulnerability reporting* (SECURITY.md
  points to it).
- **Actions**: the CI workflow runs on the next push to `main`. Check it is
  green before tagging.

## 2. npm account

```sh
npm login                     # the account that will own the package
npm profile get               # two-factor auth should say "auth-and-writes"
```

If 2FA is off: npmjs.com → Account → Two-Factor Authentication → enable for
authorization and writes.

## 3. First publish (by hand, once)

npm trusted publishing can only be configured for a package that already
exists, so the first version is published from your machine:

```sh
npm publish --access public   # asks for the 2FA code
```

Check https://www.npmjs.com/package/joinstick and run
`npx joinstick@latest --help` in an empty directory.

## 4. Turn on trusted publishing

npmjs.com → joinstick → Settings → Trusted publishing → GitHub Actions:

- Organization or user: `raprav`
- Repository: `joinstick`
- Workflow filename: `release.yml`
- Environment: leave empty

Then Settings → Publishing access → **Require two-factor authentication and
disallow tokens**. From now on only the workflow can publish, without any
token stored in GitHub, and each release gets a provenance attestation.

## 5. Tag the release

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The release workflow runs the tests and skips the publish because 0.1.0 is
already on npm. Create the GitHub release from the tag and paste the
`CHANGELOG.md` section.

## Later releases

1. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
2. `npm version patch` (or `minor`), which commits and tags `vX.Y.Z`.
3. `git push origin main --follow-tags`. The workflow publishes it.
