Browser regression tests use Node 18+ and Playwright. They serve the app locally, block external requests, and use offline mode. No Firebase credentials or live customer accounts are used.

Install test tooling outside the checkout, then run:

```sh
npm install --prefix /tmp/ataraxia-tests playwright
NODE_PATH=/tmp/ataraxia-tests/node_modules /tmp/ataraxia-tests/node_modules/.bin/playwright install chromium
NODE_PATH=/tmp/ataraxia-tests/node_modules node --test tests/ui.test.cjs
```

If Chromium is already installed, skip the browser download and set `CHROMIUM_PATH` to its executable when running the tests.
