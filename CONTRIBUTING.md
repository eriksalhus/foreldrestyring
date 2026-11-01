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

- **Language.** Code, comments, tests, documentation, commit messages and issues are in English. The domain words (Child mode, Quota, the Lock, …) are defined in [GLOSSARY.md](GLOSSARY.md); use them as defined. The app itself is multilingual: user-facing text lives in `locales/` (nine languages, `en` is the reference). A new text needs at least `en`; the other languages can follow. A driver's field labels and hints may be a plain string or a map from language code to text, with `en` required.
- **Design decisions** live in [docs/adr](docs/adr). If your change contradicts one, say so in the pull request.
- **Tests.** Logic changes come with a test. Driver code does not need a real TV in tests: fake the network.
- **Small pull requests.** One driver or one fix per pull request.
- **No secrets** in code, logs or tests.

## Reporting a problem

Open an issue with the TV brand, model and firmware, what you expected and what happened, and the app log (`homey app run` or the Homey developer tools).

## License

The project is under the [MIT License](LICENSE). By opening a pull request you agree that your contribution is released under the same license.
