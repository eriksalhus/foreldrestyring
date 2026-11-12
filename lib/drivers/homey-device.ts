import { BaseTvConnection } from './base.ts';
import type { TvDeviceInfo, TvDriver } from './types.ts';

/** How often the device is read again, to repair a missed power event and to notice a TV that went away or came back. */
export const RECONCILE_MS = 30_000;

/**
 * A TV that is already a device in Homey, of any brand. The app reads the device's on/off value and
 * switches the device off (and on) through it, so no brand-specific code or pairing is needed here.
 * The Lock is only as quick and accurate as the app that added the TV to Homey.
 * There is no way to show a message on screen through a Homey device, so `toast` is left out.
 */
class HomeyDeviceConnection extends BaseTvConnection {
  /** True when the device does not exist in Homey (any more), as opposed to being unavailable or Homey being unreachable. */
  missing = false;

  private unwatch: (() => void) | null = null;
  private watching = false;
  private reconciling = false;
  private stopped = true;
  private timer: ReturnType<typeof setInterval> | null = null;

  private get deviceId(): string {
    return this.options.config.deviceId;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_MS);
    this.timer.unref?.(); // polling alone must never keep a process alive
    void this.reconcile();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unwatch?.();
    this.unwatch = null;
    this.setOn(false);
    this.setConnection('offline');
  }

  async turnOff(): Promise<void> {
    await this.devicesOrThrow().setOn(this.deviceId, false);
  }

  async wake(): Promise<void> {
    await this.devicesOrThrow().setOn(this.deviceId, true);
  }

  private devicesOrThrow() {
    const { devices } = this.options;
    if (!devices) throw new Error('The app has no access to Homey devices');
    return devices;
  }

  private goOffline(missing: boolean): void {
    this.missing = missing;
    this.setOn(false);
    this.setConnection('offline');
  }

  private async reconcile(): Promise<void> {
    const { devices, log } = this.options;
    if (this.stopped || this.reconciling) return;
    if (!devices) {
      this.goOffline(false);
      return;
    }
    this.reconciling = true;
    let info: TvDeviceInfo | null;
    try {
      info = await devices.get(this.deviceId);
    } catch (err) {
      this.reconciling = false;
      log('Homey device error:', err instanceof Error ? err.message : err);
      if (!this.stopped) this.goOffline(false);
      return;
    }
    this.reconciling = false;
    if (this.stopped) return;
    if (!info) {
      this.goOffline(true);
      return;
    }
    this.missing = false;
    if (!info.available) {
      this.goOffline(false);
      return;
    }
    this.setConnection('connected');
    this.setOn(info.on);
    this.watch();
  }

  /** Listens for power events from Homey, so a change is seen at once and not only at the next reconcile. */
  private watch(): void {
    const { devices, log } = this.options;
    if (!devices || this.watching) return;
    this.watching = true;
    devices
      .watchPower(this.deviceId, (on) => {
        if (!this.stopped && this.connection === 'connected') this.setOn(on);
      })
      .then((unwatch) => {
        if (this.stopped) unwatch();
        else this.unwatch = unwatch;
      })
      .catch((err) => {
        this.watching = false; // try again at the next reconcile
        log('Homey device watch error:', err instanceof Error ? err.message : err);
      });
  }
}

export const homeyDevice: TvDriver = {
  id: 'homey-device',
  name: 'Homey device',
  canWake: true,
  hint: {
    en: 'Pick a TV that is already added to Homey. The app switches it off and on through that device, so it works with any TV brand Homey supports. How quickly the Lock reacts depends on the app that added the TV to Homey.',
    no: 'Velg en TV som allerede er lagt til i Homey. Appen slår den av og på via den enheten, så det fungerer med alle TV-merker Homey støtter. Hvor raskt Låsen reagerer, avhenger av appen som la TV-en til i Homey.',
    nl: 'Kies een tv die al aan Homey is toegevoegd. De app schakelt hem via dat apparaat uit en aan, dus het werkt met elk tv-merk dat Homey ondersteunt. Hoe snel het slot reageert, hangt af van de app waarmee de tv aan Homey is toegevoegd.',
    de: 'Wähle einen Fernseher, der bereits zu Homey hinzugefügt wurde. Die App schaltet ihn über dieses Gerät aus und ein, daher funktioniert sie mit jeder von Homey unterstützten Marke. Wie schnell die Sperre reagiert, hängt von der App ab, mit der der Fernseher zu Homey hinzugefügt wurde.',
    sv: 'Välj en TV som redan är tillagd i Homey. Appen stänger av och slår på den via den enheten, så det fungerar med alla TV-märken som Homey stöder. Hur snabbt låset reagerar beror på appen som lade till TV:n i Homey.',
    da: 'Vælg et tv, der allerede er føjet til Homey. Appen slukker og tænder det via den enhed, så det virker med alle tv-mærker, Homey understøtter. Hvor hurtigt låsen reagerer, afhænger af den app, der føjede tv’et til Homey.',
    fr: 'Choisissez un téléviseur déjà ajouté à Homey. L’app l’éteint et l’allume via cet appareil, donc elle fonctionne avec toutes les marques prises en charge par Homey. La rapidité du verrouillage dépend de l’app qui a ajouté le téléviseur à Homey.',
    it: 'Scegli un televisore già aggiunto a Homey. L’app lo spegne e lo accende tramite quel dispositivo, quindi funziona con ogni marca supportata da Homey. La rapidità del blocco dipende dall’app che ha aggiunto il televisore a Homey.',
    es: 'Elige un televisor que ya esté añadido a Homey. La app lo apaga y lo enciende a través de ese dispositivo, así que funciona con cualquier marca compatible con Homey. La rapidez del bloqueo depende de la app que añadió el televisor a Homey.',
  },
  fields: [
    {
      key: 'deviceId',
      kind: 'device',
      required: true,
      label: {
        en: 'TV in Homey',
        no: 'TV i Homey',
        nl: 'Tv in Homey',
        de: 'Fernseher in Homey',
        sv: 'TV i Homey',
        da: 'Tv i Homey',
        fr: 'Téléviseur dans Homey',
        it: 'Televisore in Homey',
        es: 'Televisor en Homey',
      },
    },
  ],
  createConnection: (options) => new HomeyDeviceConnection(options),
};
