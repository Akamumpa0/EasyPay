import { ChargeProvider } from './ChargeProvider';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<string, ChargeProvider> = new Map();

  private constructor() {}

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public register(provider: ChargeProvider): void {
    if (this.providers.has(provider.name)) {
      console.warn(`[ProviderRegistry] Provider ${provider.name} is already registered. Overwriting.`);
    }
    this.providers.set(provider.name, provider);
    console.log(`[ProviderRegistry] Registered provider: ${provider.name}`);
  }

  public getProvider(name: string): ChargeProvider | undefined {
    return this.providers.get(name);
  }

  public getAllProviders(): ChargeProvider[] {
    return Array.from(this.providers.values());
  }
}

export const providerRegistry = ProviderRegistry.getInstance();
