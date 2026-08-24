const path = require("node:path");

/** @type {import("pm2").StartOptions[]} */
const apps = [
  {
    name: "media-hub-dev",
    script: "pnpm",
    args: "--filter @acme/media-hub dev",
    cwd: path.resolve(__dirname, "../.."),
    interpreter: "none",
    watch: false,
    autorestart: true,
    time: true,
    env: {
      NODE_ENV: "development",
    },
  },
];

module.exports = { apps };
