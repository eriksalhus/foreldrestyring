import { LgSession } from '../lg/session.ts';
import { BaseTvConnection } from './base.ts';
import type { DriverOptions, TvDriver } from './types.ts';

/**
 * The direct connection to an LG webOS TV: the shared SSAP session keeps the TV's power state and connection
 * status up to date. The pairing key (`clientKey`) is stored as the driver's credentials.
 */
class LgWebosConnection extends BaseTvConnection {
  private session: LgSession | null = null;

  async start(): Promise<void> {
    const { config, credentials, saveCredentials, log } = this.options;
    const session = new LgSession({ host: config.host, mac: config.mac, credentials, saveCredentials, log });
    this.session = session;
    session.on('connection', (connection) => {
      this.setConnection(connection);
      if (connection !== 'connected') this.setOn(false);
    });
    session.on('power', (on) => this.setOn(on));
    await session.start();
  }

  async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.setOn(false);
    await session?.stop();
  }

  async toast(message: string): Promise<void> {
    await this.session?.toast(message);
  }

  async turnOff(): Promise<void> {
    await this.session?.turnOff();
  }

  async wake(): Promise<void> {
    await this.session?.wake();
  }
}

export const lgWebos: TvDriver = {
  id: 'lg-webos',
  name: 'LG webOS',
  canWake: true,
  canToast: true,
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
