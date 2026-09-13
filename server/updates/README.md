UPDATE FEED
===========

The Electron client auto-updates from this folder.

Deploy flow
-----------
1. Bump the version in client/package.json (and client/package-lock.json),
   then build (npm run dist / dist:linux). electron-builder emits a
   "latest.yml" metadata file plus the installer into the dist folder.
2. Copy the new "latest.yml" and the matching installer (.exe / .AppImage)
   into THIS folder (server/updates/).
3. On the server host, run `git pull` so `getAppVersion()` (read from
   client/package.json) reports the new version.
4. Restart `node server.js`. Every client polls /api/version and compares
   against its installed version; when they differ, electron-updater
   downloads the installer from /updates and quits + installs.

Admin can also push an immediate check: Admin console -> TRIGGER UPDATE
CHECK broadcasts an "update" WS signal to all connected clients, which
tells them to check right away (instead of waiting for the next poll).

Feed URL: https://<host>/updates/  (served by express.static)