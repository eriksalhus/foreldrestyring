import type { TvDeviceInfo, TvDevices } from './drivers/types.ts';

/**
 * The TVs in Homey, through Homey's Web API. This needs the `homey:manager:api` permission: it is the only
 * way for an app to read and switch devices that belong to other apps. The app lists devices to find TVs and
 * reads and switches only the one the user chose; nothing leaves the Homey.
 */

/** The part of the Homey Web API (`homey-api`) this file uses. */
export interface ApiDevice {
  id: string;
  name: string;
  zone: string;
  class: string;
  virtualClass?: string | null;
  capabilities: string[];
  capabilitiesObj?: { onoff?: { value?: unknown } };
  available: boolean;
  makeCapabilityInstance(capabilityId: string, listener: (value: unknown) => void): { destroy(): void };
}

export interface HomeyApi {
  devices: {
    getDevices(): Promise<Record<string, ApiDevice>>;
    getDevice(opts: { id: string }): Promise<ApiDevice>;
    setCapabilityValue(opts: { deviceId: string; capabilityId: string; value: boolean }): Promise<unknown>;
  };
  zones: { getZones(): Promise<Record<string, { id: string; name: string }>> };
}

/** A TV the app can control: Homey says it is a TV (a class the user may have overridden) and it has `onoff`. */
function isControllableTv(device: ApiDevice): boolean {
  return (device.virtualClass || device.class) === 'tv' && device.capabilities.includes('onoff');
}

function toInfo(device: ApiDevice, zones: Record<string, { name: string }>): TvDeviceInfo {
  return {
    id: device.id,
    name: device.name,
    zone: zones[device.zone]?.name ?? '',
    on: device.capabilitiesObj?.onoff?.value === true,
    available: device.available !== false,
  };
}

/** Homey answers 404 when a device has been removed. */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { statusCode?: number }).statusCode === 404;
}

export class HomeyDevices implements TvDevices {
  private api: Promise<HomeyApi> | null = null;
  private readonly createApi: () => Promise<HomeyApi>;

  /** `createApi` makes the Web API client. It is called on first use, and again after a failure. */
  constructor(createApi: () => Promise<HomeyApi>) {
    this.createApi = createApi;
  }

  private getApi(): Promise<HomeyApi> {
    if (!this.api) {
      this.api = this.createApi().catch((err) => {
        this.api = null; // retry next time, e.g. when the permission is granted later
        throw err;
      });
    }
    return this.api;
  }

  async list(): Promise<TvDeviceInfo[]> {
    const api = await this.getApi();
    const [devices, zones] = await Promise.all([api.devices.getDevices(), api.zones.getZones()]);
    return Object.values(devices)
      .filter(isControllableTv)
      .map((device) => toInfo(device, zones));
  }

  async get(id: string): Promise<TvDeviceInfo | null> {
    const api = await this.getApi();
    try {
      const device = await api.devices.getDevice({ id });
      if (!isControllableTv(device)) return null;
      return toInfo(device, {});
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async setOn(id: string, on: boolean): Promise<void> {
    const api = await this.getApi();
    await api.devices.setCapabilityValue({ deviceId: id, capabilityId: 'onoff', value: on });
  }

  async watchPower(id: string, listener: (on: boolean) => void): Promise<() => void> {
    const api = await this.getApi();
    const device = await api.devices.getDevice({ id });
    const instance = device.makeCapabilityInstance('onoff', (value) => listener(value === true));
    return () => instance.destroy();
  }
}

/** Creates the Web API client for this app. Needs the `homey:manager:api` permission. */
export async function createHomeyApi(homey: unknown): Promise<HomeyApi> {
  const mod = await import('homey-api');
  const HomeyAPI = (mod as any).HomeyAPI ?? (mod as any).default?.HomeyAPI;
  return (await HomeyAPI.createAppAPI({ homey })) as HomeyApi;
}
