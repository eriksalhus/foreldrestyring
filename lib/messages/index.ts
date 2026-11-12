import { describeFields, resolveText } from '../drivers/index.ts';
import type { FieldDescription } from '../drivers/index.ts';
import { lgWebosMessages } from './lg-webos.ts';
import type { MessageProvider } from './types.ts';

/**
 * Every kind of TV that can show On-screen messages for a Homey device. To add one: write a provider
 * (docs/adding-a-message-provider.md) and put it here.
 */
export const MESSAGE_PROVIDERS: readonly MessageProvider[] = [lgWebosMessages];

export function getMessageProvider(id: string, providers: readonly MessageProvider[] = MESSAGE_PROVIDERS): MessageProvider | undefined {
  return providers.find((p) => p.id === id);
}

export interface MessageProviderDescription {
  id: string;
  name: string;
  hint: string;
  fields: FieldDescription[];
}

/** What the settings page needs to draw a provider's fields, in the user's language. */
export function describeMessageProvider(provider: MessageProvider, language: string): MessageProviderDescription {
  return {
    id: provider.id,
    name: provider.name,
    hint: resolveText(provider.hint, language),
    fields: describeFields(provider.fields, language),
  };
}
