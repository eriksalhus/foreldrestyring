# Publishing to the Homey App Store

Maintainer checklist. Publishing is started by a person with a Homey developer account, either locally or by running a GitHub Actions workflow by hand.

## Before the first publish

- [ ] `homey app validate --level publish` passes (it does at the time of writing).
- [ ] `npm test` and `npm run typecheck` pass, and the GitHub Actions run on `main` is green.
- [ ] The repository is **public**. The manifest links to it (`source`, `bugs`), and store users, reviewers and contributors follow those links.
- [x] A topic for the app on the [Homey Community Forum](https://community.homey.app/t/app-pro-tv-parental-control-daily-tv-time-quota-for-your-kids/161648) exists, and its number is `homeyCommunityTopicId` in `.homeycompose/app.json`. Reviewers and users expect it as the support channel.
- [ ] Test on a real Homey Pro with a real TV: first pairing ("Allow" on the TV), Child mode, the Lock, Extra time, Remove time, automatic turn-on and turn-off, and the widget on a dashboard.
- [x] Decide the version number for certification: `1.0.0`. The entry in `.homeychangelog.json` must match the version being published.

## What the store shows

| Item | Where |
| --- | --- |
| Name, description, category, brand colour | `.homeycompose/app.json` |
| Store text | `README.txt` (English, required) and `README.<language>.txt`. Plain text, no Markdown. |
| Images | `assets/images/{small,large,xlarge}.png` (250×175, 500×350, 1000×700), made from `docs/promo.svg` |
| App icon | `assets/icon.svg` |
| Widget previews | `widgets/barnemodus/preview-{light,dark}.png` (1024×1024, transparent corners), made from `docs/widget-preview-{light,dark}.svg` |
| What's new | `.homeychangelog.json`, keyed by version |

`README.md` is for GitHub only and is not shipped; `.homeyignore` keeps the repository files out of the app bundle.

## Publishing

```sh
homey login
homey app publish
```

Or run the **Publish Homey App** workflow from the Actions tab on GitHub. It needs a repository secret `HOMEY_PAT`, a personal access token from the [Homey developer tools](https://tools.developer.homey.app).

`homey app publish` uploads a build, and the app first appears as a **test version** that only people with the link can install. When it has been tried, submit it for certification in the [Homey developer tools](https://tools.developer.homey.app); Athom reviews it before it goes live in the store.

## Releasing a new version

```sh
homey app version patch   # or minor / major: bumps the version in .homeycompose/app.json
```

Add an entry for the new version to `.homeychangelog.json`, commit, and run `homey app publish` again.

The **Update Homey App Version** workflow on GitHub does the bump and the changelog entry in one go, then pushes the commit, a `v<version>` tag and a GitHub release straight to `main`.

## Things to keep in mind

- **Do not change the app id** (`no.salhus.foreldrestyring`) or the widget id (`barnemodus`) after publishing. Users' installs and dashboards depend on them.
- **Brand names.** The app name does not contain a TV brand, and the store text says it is not affiliated with LG Electronics. Keep it that way when adding drivers: the app name stays generic, and brands appear only in the description of what is supported.
- **Privacy.** The app talks only to the TV on the local network and sends nothing elsewhere. Say so in the store text if that ever changes.
- **Settings are not migrated by Homey.** If you change the stored settings shape, migrate it in `migrateSavedSettings` (see `lib/controller.ts`), as was done when drivers were introduced.

## Regenerating images

The PNGs are rendered from the SVG sources in `docs/` with headless Chrome. Redo them when the widget or the logo changes, for example:

```sh
chrome --headless=new --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot=widgets/barnemodus/preview-light.png file:///path/to/page-showing-the-svg.html
```

Keep the corners transparent and the size at 1024×1024 for the widget previews; the store images are 250×175, 500×350 and 1000×700.
