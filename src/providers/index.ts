import { providerRegistry } from './ProviderRegistry';
import { FlutterwaveProvider } from './FlutterwaveProvider';
import { PaystackProvider } from './PaystackProvider';

// Export interfaces and common types
export * from './ChargeProvider';
export * from './PayoutProvider';
export * from './ProviderRegistry';
export * from './FlutterwaveProvider';
export * from './PaystackProvider';

// Register all known providers dynamically
providerRegistry.register(new FlutterwaveProvider());
providerRegistry.register(new PaystackProvider());

// When adding new providers, simply import and register them here.
