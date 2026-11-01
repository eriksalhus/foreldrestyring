# TV Parental Control (TV-foreldrestyring)

Homey Pro-app som gir TV-en en daglig tidskvote, styrt fra Homey-appen. Støttede TV-er: LG webOS. Flere merker kan legges til som egne drivere, se [CONTRIBUTING.md](CONTRIBUTING.md). Språket i prosjektet er definert i [GLOSSARY.md](GLOSSARY.md), og de viktigste designvalgene står i [docs/adr](docs/adr).

## Utvikling

```sh
npm install
npm test            # enhetstester for kvotelogikken, Controller og TV-driverne
npm run typecheck
homey app validate  # bygger og validerer
homey app run       # kjører på valgt Homey (krever Docker), logger i terminalen
homey app install   # installerer permanent på valgt Homey
```

`app.json` genereres fra `.homeycompose/app.json` av `homey app build`. Rediger `.homeycompose/app.json`.

## Legge til et nytt TV-merke

Hvert merke er én fil i `lib/drivers/`, som oppfyller kontrakten i `lib/drivers/types.ts`. Kvote, Barnemodus, innstillingsside og widget fungerer uendret for alle merker. Fremgangsmåten står i [docs/adding-a-tv.md](docs/adding-a-tv.md), og valget er begrunnet i [ADR 0002](docs/adr/0002-tv-drivere.md).

## Oppsett på TV-en (LG G2, webOS 22)

1. Slå på «LG Connect Apps» og «Slå på via Wi-Fi/mobil» (Wake-on-LAN) i TV-innstillingene.
2. Gi TV-en fast IP i routeren, helst på kabel.
3. Åpne appens innstillinger i Homey: fyll inn IP og MAC, trykk «Lagre og koble til», og trykk «Tillat» på TV-en.
4. Legg widgeten «Barnemodus» på et Homey-dashbord.

## Lisens

[MIT](LICENSE).
