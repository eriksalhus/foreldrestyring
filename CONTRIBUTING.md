# Contributing

The most useful contribution is **support for another TV brand**. That is one new file, a TV driver. See [docs/adding-a-tv.md](docs/adding-a-tv.md).

Other contributions are welcome too: bug reports, translations, and fixes.

## Setup

```sh
npm install
npm test            # unit tests, no TV or Homey needed
npm run typecheck
homey app run       # run on your own Homey Pro (needs Docker); logs in the terminal
```

Node.js 22.18 or newer is needed for the tests: they run TypeScript directly. For that reason the source uses only syntax that can be stripped (`erasableSyntaxOnly`): no `enum`, no `namespace`, no constructor parameter properties, and relative imports end in `.ts`.

## Ground rules

- **Language.** The domain words (Child mode, Quota, the Lock, …) are defined in [GLOSSARY.md](GLOSSARY.md), in Norwegian, with the English term in the app's texts. Use them as defined. Code comments are in English or Norwegian; either is fine. User-facing text must be in all nine languages in `locales/` (`en` is the reference), but for a first version of a driver `en` alone is enough.
- **Design decisions** live in [docs/adr](docs/adr). If your change contradicts one, say so in the pull request.
- **Tests.** Logic changes come with a test. Driver code does not need a real TV in tests: fake the network.
- **Small pull requests.** One driver or one fix per pull request.
- **No secrets** in code, logs or tests.

## Reporting a problem

Open an issue with the TV brand, model and firmware, what you expected and what happened, and the app log (`homey app run` or the Homey developer tools).
