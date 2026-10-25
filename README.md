# Foreldrestyring

Homey Pro-app som gir en LG webOS-TV en daglig tidskvote, styrt fra Homey-appen. Språket i prosjektet er definert i [GLOSSARY.md](GLOSSARY.md), og de viktigste designvalgene står i [docs/adr](docs/adr).

## Utvikling

```sh
npm install
npm test            # enhetstester for kvotelogikken
npm run typecheck
homey app validate  # bygger og validerer
homey app run       # kjører på valgt Homey (krever Docker), logger i terminalen
homey app install   # installerer permanent på valgt Homey
```

`app.json` genereres fra `.homeycompose/app.json` av `homey app build`. Rediger `.homeycompose/app.json`.

## Oppsett på TV-en (LG G2, webOS 22)

1. Slå på «LG Connect Apps» og «Slå på via Wi-Fi/mobil» (Wake-on-LAN) i TV-innstillingene.
2. Gi TV-en fast IP i routeren, helst på kabel.
3. Åpne appens innstillinger i Homey: fyll inn IP og MAC, trykk «Lagre og koble til», og trykk «Tillat» på TV-en.
4. Legg widgeten «Barnemodus» på et Homey-dashbord.
