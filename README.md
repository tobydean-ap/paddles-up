# Paddles Up

Strictly watch-party scoring. Everyone opens the link on their phone, adds themselves as a judge and holds up a paddle after each dance. Scores, couples, the week and custom sounds are shared live with everyone.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

## Deploy on Railway

1. Push this folder to a new GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** and pick it. Railway detects Node and runs `npm start`.
3. **Add a volume** so scores survive redeploys: on the service, add a Volume mounted at `/data`, then add the variable `DATA_DIR=/data`.
4. **Settings → Networking → Generate Domain**, then share that link with the party.

Health check: `/health`.

## Notes

- Anyone with the link can score and edit, so share it only with your guests.
- To start a fresh series, delete `party.json` from the volume (or remove and re-add the volume) and redeploy.
- Each phone gets an anonymous device id, stored in the browser. Clearing site data on a phone gives it a new, empty judge.
