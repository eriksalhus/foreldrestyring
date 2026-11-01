---
status: accepted
---

# Hver TV-merke er en driver bak ett lite grensesnitt, og alle drivere ligger i denne appen

Appen var bygget rundt LG webOS: Controller laget en `TvClient` for lgtv2 direkte, innstillingene hadde `host` og `mac`, og innstillingssiden hadde fastkodede felt for dem. For at andre skal kunne legge til TV-er uten å røre kvotelogikken er alt merke-spesifikt flyttet bak `TvDriver` (`lib/drivers/types.ts`). En driver beskriver feltene innstillingssiden skal tegne, lager en `TvConnection` som sier om TV-en er på, og kan vise melding, slå av og eventuelt slå på. Drivere registreres i `lib/drivers/index.ts`.

## Considered Options

- **Én Homey-app per merke, koblet via Homey-enheter eller Flows:** Homey-apper kan ikke importere hverandre, og eksisterende TV-apper har ulik kvalitet og mangler pålitelig strømstatus (se [0001](0001-laasen-er-gjentatt-av-slaaing-i-egen-homey-app.md)).
- **Drivere som egne npm-pakker som lastes ved kjøring:** gir fleksibilitet, men Homey Pro har ingen trygg måte å installere pakker i en kjørende app på, og ukjent kode med tilgang til hjemmenettet er uønsket.
- **Én fil per merke i dette repoet (valgt):** bidrag kommer som pull requests, hver driver gjennomgås og testes sammen med resten, og brukeren får alt i én app.

## Consequences

- Nye TV-er krever en ny versjon av appen. Det er ikke mulig å legge til en driver uten å publisere appen på nytt.
- Feltene er bare tekstfelt (`DriverField`). Trenger et merke mer (for eksempel en PIN-dialog), utvides kontrakten, ikke siden med merkespesifikk kode.
- Lagret oppsett har `driver` og `driverConfig` i stedet for `host` og `mac`. Eldre oppsett oversettes til `lg-webos` ved oppstart, og den gamle `clientKey` leses fortsatt, så eksisterende brukere merker ingenting.
- Paringsdata ligger per driver under `tvCredentials`.
- Kontrakten har `isOn` og `connection` som felles språk. `BaseTvConnection` sørger for at en TV uten kontakt aldri regnes som på, ellers ville Kvoten fortsatt gått.
- Alle drivere kjøres gjennom samme kontraktstest (`tests/drivers.test.ts`), og en simulert TV gjør det mulig å teste Controller uten maskinvare.
