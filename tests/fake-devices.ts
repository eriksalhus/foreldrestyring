import type { TvDeviceInfo, TvDevices } from '../lib/drivers/types.ts';

/** A Homey that exists only in memory: a few TV devices, and the power events Homey would push. */
export class FakeDevices implements TvDevices {
  readonly devices = new Map<string, TvDeviceInfo>();
  readonly setCalls: Array<{ id: string; on: boolean }> = [];
  readonly getCalls: string[] = [];
  readonly watchers = new Map<string, Set<(on: boolean) => void>>();
  unreachable = false;

  add(over: Partial<TvDeviceInfo> = {}): TvDeviceInfo {
    const info = { id: 'tv1', name: 'Living room TV', zone: 'Living room', on: false, available: true, ...over };
    this.devices.set(info.id, info);
    return info;
  }

  async list(): Promise<TvDeviceInfo[]> {
    return [...this.devices.values()];
  }

  async get(id: string): Promise<TvDeviceInfo | null> {
    this.getCalls.push(id);
    if (this.unreachable) throw new Error('Homey is not reachable');
    return this.devices.get(id) ?? null;
  }

  async setOn(id: string, on: boolean): Promise<void> {
    this.setCalls.push({ id, on });
  }

  async watchPower(id: string, listener: (on: boolean) => void): Promise<() => void> {
    const set = this.watchers.get(id) ?? new Set();
    set.add(listener);
    this.watchers.set(id, set);
    return () => set.delete(listener);
  }

  /** The user presses the power button and the TV's Homey app reports it. */
  press(id: string, on: boolean): void {
    this.devices.get(id)!.on = on;
    for (const listener of this.watchers.get(id) ?? []) listener(on);
  }
}
