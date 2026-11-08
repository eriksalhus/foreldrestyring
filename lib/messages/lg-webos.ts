import { EventEmitter } from 'node:events';
import { lgWebos } from '../drivers/lg-webos.ts';
import type { Connection, TvDeviceInfo } from '../drivers/types.ts';
import { LgSession } from '../lg/session.ts';
import type { LgSessionOptions } from '../lg/session.ts';
import type { MessageChannel, MessageOptions, MessageProvider } from './types.ts';

/**
 * Homey apps that add LG webOS TVs to Homey. A Homey TV owned by one of these can show messages through this
 * provider. To support another LG app, add its app id (the `id` in its app.json) here, and check which device
 * setting holds the TV's IP address (see `IP_SETTINGS`).
 *
 * - `com.lg.webos`: the official "LG WebOS TV" app.
 * - `com.maxvandelaar.webos-plus`: the community app "WebOS Plus". Its `ipAddress` setting is verified.
 * - `com.lge.thinq.appliance`: LG ThinQ, which controls LG appliances through LG's cloud. A device of class `tv` from it
 *   is an LG TV. It keeps no IP address (its device settings are only `energy_value_on` and `energy_value_off`), so the
 *   user types the address. A TV without webOS or with "LG Connect Apps" off simply never links.
 */
export const LG_APP_IDS: ReadonlySet<string> = new Set([
  'com.lg.webos',
  'com.maxvandelaar.webos-plus',
  'com.lge.thinq.appliance',
]);

/**
 * The device settings that may hold the TV's IP address, in order. `ipAddress` is verified for WebOS Plus; the others
 * are plausible names for the official app and are harmless if wrong, because only a usable IPv4 address is
 * accepted and the user can always change what is suggested.
 */
const IP_SETTINGS = ['ipAddress', 'ip', 'host'];

/** A usable IPv4 address: four numbers up to 255, and not the placeholder `0.0.0.0`. */
function usableIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return ip === '0.0.0.0' ? null : ip;
}

/** Messages only: the same SSAP link as the direct driver, without following the TV's power state. */
class LgMessageChannel extends EventEmitter implements MessageChannel {
  connection: Connection = 'connecting';
  private readonly session: LgSession;

  constructor(options: MessageOptions, createClient: LgSessionOptions['createClient']) {
    super();
    this.session = new LgSession({
      host: options.config.host,
      credentials: options.credentials,
      saveCredentials: options.saveCredentials,
      log: options.log,
      followPower: false,
      createClient,
    });
    this.session.on('connection', (connection: Connection) => {
      this.connection = connection;
      this.emit('connection', connection);
    });
  }

  start(): Promise<void> {
    return this.session.start();
  }

  stop(): Promise<void> {
    return this.session.stop();
  }

  send(text: string): Promise<void> {
    return this.session.toast(text);
  }
}

/** `createClient` is for tests; the default connects to the TV for real. */
export function createLgMessageProvider(createClient?: LgSessionOptions['createClient']): MessageProvider {
  const host = lgWebos.fields.find((f) => f.key === 'host')!;
  return {
    id: 'lg-webos', // the same id as the TV driver, so both share the pairing key and the user presses "Allow" only once
    name: 'LG webOS',
    hint: {
      en: 'On the TV, turn on “LG Connect Apps” and give the TV a fixed IP address in your router. Press “Link to TV”, then press “Allow” on the TV with the remote. You only do this once.',
      no: 'På TV-en må «LG Connect Apps» være slått på. Gi TV-en fast IP-adresse i routeren. Trykk «Koble til TV», og trykk deretter «Tillat» på TV-en med fjernkontrollen. Du gjør dette bare én gang.',
      nl: 'Zet op de tv “LG Connect Apps” aan. Geef de tv een vast IP-adres in je router. Druk op “Koppelen met tv” en druk daarna op “Toestaan” op de tv met de afstandsbediening. Dit hoef je maar één keer te doen.',
      de: 'Aktiviere am Fernseher „LG Connect Apps“. Vergib dem Fernseher im Router eine feste IP-Adresse. Tippe auf „Mit Fernseher verknüpfen“ und bestätige dann mit der Fernbedienung „Zulassen“ am Fernseher. Das musst du nur einmal tun.',
      sv: 'Slå på ”LG Connect Apps” i TV:n. Ge TV:n en fast IP-adress i routern. Tryck på ”Länka till TV” och tryck sedan på ”Tillåt” på TV:n med fjärrkontrollen. Du gör detta bara en gång.',
      da: 'Slå ”LG Connect Apps” til på tv\'et. Giv tv\'et en fast IP-adresse i din router. Tryk på ”Forbind med tv”, og tryk derefter på ”Tillad” på tv\'et med fjernbetjeningen. Du skal kun gøre det én gang.',
      fr: 'Sur la télévision, activez « LG Connect Apps ». Attribuez une adresse IP fixe à la télévision dans votre routeur. Appuyez sur « Associer à la télévision », puis sur « Autoriser » sur la télévision avec la télécommande. Vous ne le faites qu’une seule fois.',
      it: 'Sul televisore attiva “LG Connect Apps”. Assegna al televisore un indirizzo IP fisso nel router. Premi “Collega al televisore”, poi premi “Consenti” sul televisore con il telecomando. Lo fai una sola volta.',
      es: 'En el televisor, activa “LG Connect Apps”. Asigna una dirección IP fija al televisor en tu router. Pulsa “Vincular con el televisor” y luego pulsa “Permitir” en el televisor con el mando. Solo tienes que hacerlo una vez.',
    },
    fields: [host],
    matches: (device: TvDeviceInfo) => LG_APP_IDS.has(device.appId),
    suggestConfig(device: TvDeviceInfo): Record<string, string> {
      if (!LG_APP_IDS.has(device.appId)) return {};
      for (const key of IP_SETTINGS) {
        const ip = usableIp(device.settings[key]);
        if (ip) return { host: ip };
      }
      return {};
    },
    createChannel: (options: MessageOptions) => new LgMessageChannel(options, createClient),
  };
}

export const lgWebosMessages: MessageProvider = createLgMessageProvider();
