---
status: accepted
---

# Låsen er gjentatt av-slåing, i en egen Homey Pro-app med egen SSAP-klient

LG webOS har ingen SSAP-kall som låser TV-en eller deaktiverer fjernkontrollen, og en lås-app på TV-en kan ikke ligge over andre apper uten rooting. **Låsen** er derfor at tjenesten slår TV-en av (`turnOff`) hver gang den ser at TV-en er på mens Kvoten er brukt opp. Tjenesten er en egen Homey Pro-app som snakker SSAP direkte med TV-en (wss, port 3001), ikke et sett Flows eller en eksisterende LG-app.

## Considered Options

- **Flows + eksisterende LG-app:** minuttflows hopper over og kommer i byks, forsinkede kort går tapt ved omstart, og LG-appene mangler pålitelig strømstatus eller er dårlig vedlikeholdt.
- **Hybrid (LG-app for status og av-kommando + egen teller-app):** arver LG-appenes feil.
- **Raspberry Pi med aiowebostv:** mest deterministisk, men én enhet til å vedlikeholde, og Homey er uansett kontrollpanelet. Logikken kan flyttes dit senere.
- **Rooting + Homebrew Channel for ekte lås på TV-en:** uoffisielt og risikabelt, og ikke nødvendig for målgruppen (barn under ca. 13 år).

## Consequences

- Barna ser bilde i noen sekunder hver gang TV-en slås på mens Låsen er aktiv, og fjernkontrollen kan ikke hindres i å slå TV-en på.
- Opplåsing og «på» krever Wake-on-LAN, og «LG Connect Apps» må være slått på.
- Telling bruker egne tidsstempler og regner tapt kontakt som «TV av», så et tapt tikk eller en Homey-omstart koster på det meste noen minutter.
