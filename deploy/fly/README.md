# Paint Party on Fly.io

Joinstick serving `examples/paint-party` at `/demo/paint-party/` (`/` redirects
there). Rooms live in memory, so it runs as one machine. Run these from the repo
root; if the app name is not `joinstick`, change `app` and `PUBLIC_URL` in
`fly.toml` first.

```sh
fly apps create joinstick
fly deploy . --config deploy/fly/fly.toml --dockerfile deploy/fly/Dockerfile --ha=false
fly scale count 1 --config deploy/fly/fly.toml   # back to one machine if there are more
fly status --config deploy/fly/fly.toml
fly logs --config deploy/fly/fly.toml
```

Try the image locally: `docker build -f deploy/fly/Dockerfile -t joinstick-demo .`, then
`docker run --rm -p 3005:3000 -e PUBLIC_URL=http://localhost:3005 joinstick-demo`.
