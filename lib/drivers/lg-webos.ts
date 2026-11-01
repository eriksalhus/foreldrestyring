import { BaseTvConnection } from './base.ts';
import type { DriverOptions, TvDriver } from './types.ts';

type LgModule = typeof import('lgtv2', { with: { 'resolution-mode': 'import' } });
type LgClient = InstanceType<LgModule['default']>;

/** States in which the TV counts as on: the picture may be off, but the TV is not in standby. */
const ON_STATES = new Set(['on', 'screen_off', 'screen_saver']);

/**
 * Thin layer over lgtv2 (SSAP over wss): keeps the TV's power state and connection status up to date.
 * The pairing key (`clientKey`) is stored as the driver's credentials.
 */
class LgWebosConnection extends BaseTvConnection {
  private lg: LgClient | null = null;
  private powerSubscription: string | undefined;

  async start(): Promise<void> {
    const { default: LG } = await import('lgtv2');
    const { config, credentials, saveCredentials, log } = this.options;
    const lg = new LG({
      host: config.host,
      mac: config.mac || undefined,
      clientKey: typeof credentials === 'string' && credentials ? credentials : undefined,
      saveKey: (key, cb) => {
        saveCredentials(key);
        cb();
      },
      learnMac: false,
      reconnect: 5000,
    });
    this.lg = lg;

    lg.on('connecting', () => {
      if (this.connection !== 'prompt') this.setConnection('connecting');
    });
    lg.on('prompt', () => this.setConnection('prompt'));
    lg.on('connect', () => {
      this.setConnection('connected');
      if (this.powerSubscription) lg.unsubscribe(this.powerSubscription);
      this.powerSubscription = lg.subscribePowerState((err, result) => {
        if (err || !result) return;
        this.setOn(ON_STATES.has(result.state));
      });
    });
    lg.on('close', () => {
      this.setConnection('offline');
      this.setOn(false);
    });
    lg.on('error', (err) => log('TV error:', err.message));
  }

  async stop(): Promise<void> {
    const lg = this.lg;
    this.lg = null;
    this.setOn(false);
    await lg?.disconnect();
  }

  async toast(message: string): Promise<void> {
    await this.lg?.request('ssap://system.notifications/createToast', { message });
  }

  async turnOff(): Promise<void> {
    await this.lg?.request('ssap://system/turnOff');
  }

  async wake(): Promise<void> {
    await this.lg?.wake(this.options.config.mac || undefined);
  }
}

export const lgWebos: TvDriver = {
  id: 'lg-webos',
  name: 'LG webOS',
  canWake: true,
  hint: {
    en: 'On the TV, turn on “LG Connect Apps” and “Turn on via Wi-Fi” (Wake-on-LAN). Give the TV a fixed IP address in your router. The first time you connect, press “Allow” on the TV with the remote.',
    no: 'På TV-en må «LG Connect Apps» og «Slå på via Wi-Fi/mobil» (Wake-on-LAN) være slått på. Gi TV-en fast IP-adresse i routeren. Trykk «Tillat» på TV-en med fjernkontrollen første gang du kobler til.',
    nl: 'Zet op de tv “LG Connect Apps” en “Inschakelen via Wi-Fi” (Wake-on-LAN) aan. Geef de tv een vast IP-adres in je router. Druk bij de eerste verbinding op “Toestaan” op de tv met de afstandsbediening.',
    de: 'Aktiviere am Fernseher „LG Connect Apps“ und „Über WLAN einschalten“ (Wake-on-LAN). Vergib dem Fernseher im Router eine feste IP-Adresse. Bestätige beim ersten Verbinden mit der Fernbedienung „Zulassen“ am Fernseher.',
    sv: 'Slå på ”LG Connect Apps” och ”Slå på via Wi-Fi” (Wake-on-LAN) i TV:n. Ge TV:n en fast IP-adress i routern. Första gången du ansluter trycker du på ”Tillåt” på TV:n med fjärrkontrollen.',
    da: 'Slå ”LG Connect Apps” og ”Tænd via Wi-Fi” (Wake-on-LAN) til på tv\'et. Giv tv\'et en fast IP-adresse i din router. Første gang du forbinder, skal du trykke på ”Tillad” på tv\'et med fjernbetjeningen.',
    fr: 'Sur la télévision, activez « LG Connect Apps » et « Allumer via Wi-Fi » (Wake-on-LAN). Attribuez une adresse IP fixe à la télévision dans votre routeur. Lors de la première connexion, appuyez sur « Autoriser » sur la télévision avec la télécommande.',
    it: 'Sul televisore attiva “LG Connect Apps” e “Accendi tramite Wi-Fi” (Wake-on-LAN). Assegna al televisore un indirizzo IP fisso nel router. Al primo collegamento premi “Consenti” sul televisore con il telecomando.',
    es: 'En el televisor, activa “LG Connect Apps” y “Encender mediante Wi-Fi” (Wake-on-LAN). Asigna una dirección IP fija al televisor en tu router. La primera vez que te conectes, pulsa “Permitir” en el televisor con el mando.',
  },
  fields: [
    {
      key: 'host',
      required: true,
      inputMode: 'decimal',
      placeholder: '192.168.1.50',
      label: {
        en: 'TV IP address',
        no: 'TV-ens IP-adresse',
        nl: 'IP-adres van de tv',
        de: 'IP-Adresse des Fernsehers',
        sv: 'TV:ns IP-adress',
        da: 'Tv\'ets IP-adresse',
        fr: 'Adresse IP de la télévision',
        it: 'Indirizzo IP del televisore',
        es: 'Dirección IP del televisor',
      },
    },
    {
      key: 'mac',
      placeholder: 'AA:BB:CC:DD:EE:FF',
      label: {
        en: 'TV MAC address (to turn the TV on)',
        no: 'TV-ens MAC-adresse (for å slå på TV-en)',
        nl: 'MAC-adres van de tv (om de tv in te schakelen)',
        de: 'MAC-Adresse des Fernsehers (zum Einschalten)',
        sv: 'TV:ns MAC-adress (för att slå på TV:n)',
        da: 'Tv\'ets MAC-adresse (for at tænde tv\'et)',
        fr: 'Adresse MAC de la télévision (pour l’allumer)',
        it: 'Indirizzo MAC del televisore (per accenderlo)',
        es: 'Dirección MAC del televisor (para encenderlo)',
      },
    },
  ],
  createConnection: (options: DriverOptions) => new LgWebosConnection(options),
};
