# VectorDB Activity Monitoring

The VectorDB module now includes comprehensive activity monitoring capabilities similar to the kernel manager. This allows for automatic offloading of inactive vector database instances to disk and resuming them when needed.

## Features

- **Activity Tracking**: Monitor when vector indices are accessed (queries, document additions/removals)
- **Automatic Offloading**: Inactive indices are automatically offloaded to disk after a configurable timeout
- **Resume from Offload**: When an offloaded index is requested again, it's automatically resumed from disk
- **Manual Management**: Manual offloading, ping functionality, and timeout configuration
- **Namespace Support**: Activity monitoring works with namespaced indices

## Configuration

### Environment Variables

When using the Hypha service, configure activity monitoring via environment variables:

```bash
# Directory to store offloaded indices (default: ./vectordb_offload)
VECTORDB_OFFLOAD_DIRECTORY="./my_vectordb_offload"

# Default inactivity timeout in milliseconds (default: 1800000 = 30 minutes)
VECTORDB_DEFAULT_INACTIVITY_TIMEOUT="3600000"  # 1 hour

# Enable/disable activity monitoring globally (default: true)
VECTORDB_ACTIVITY_MONITORING="true"
```

### VectorDBManager Options

```typescript
const manager = new VectorDBManager({
  // Standard options
  defaultEmbeddingModel: "mock-model", // or use provider registry
  maxInstances: 50,
  allowedNamespaces: ["workspace1", "workspace2"],
  
  // Activity monitoring options
  offloadDirectory: "./vectordb_offload",
  defaultInactivityTimeout: 30 * 60 * 1000, // 30 minutes
  enableActivityMonitoring: true
});
```

### Index-Level Configuration

```typescript
// Create an index with custom activity monitoring settings
const indexId = await manager.createIndex({
  id: "my-index",
  namespace: "workspace1",
  
  // Activity monitoring options
  enableActivityMonitoring: true,  // Enable for this index
  inactivityTimeout: 60 * 60 * 1000, // 1 hour timeout
});

// Create an index that never gets offloaded
const persistentIndexId = await manager.createIndex({
  id: "persistent-index",
  enableActivityMonitoring: false, // Disable activity monitoring
});
```

## API Methods

### Activity Monitoring

```typescript
// Get last activity time
const lastActivity = manager.getLastActivityTime(indexId);
console.log(`Last activity: ${new Date(lastActivity).toISOString()}`);

// Get time until offload
const timeUntilOffload = manager.getTimeUntilOffload(indexId);
console.log(`Time until offload: ${timeUntilOffload}ms`);

// Ping an index to reset activity timer
const success = manager.pingInstance(indexId);

// Set/update inactivity timeout
manager.setInactivityTimeout(indexId, 2 * 60 * 60 * 1000); // 2 hours
```

### Manual Offloading

```typescript
// Manually offload an index
await manager.manualOffload(indexId);

// List offloaded indices
const offloadedIndices = await manager.listOffloadedIndices("workspace1");
for (const index of offloadedIndices) {
  console.log(`${index.id}: ${index.documentCount} documents, offloaded at ${index.offloadedAt}`);
}

// Delete an offloaded index from disk
await manager.deleteOffloadedIndex(indexId);
```

### Global Settings

```typescript
// Enable/disable activity monitoring globally
manager.setActivityMonitoring(false); // Disables all timers
manager.setActivityMonitoring(true);  // Re-enables based on index settings

// Get comprehensive stats including activity monitoring
const stats = manager.getStats();
console.log(stats.activityMonitoring);
// {
//   enabled: true,
//   defaultTimeout: 1800000,
//   activeTimers: 5,
//   offloadDirectory: "./vectordb_offload"
// }
```

## Events

Listen for activity monitoring events:

```typescript
manager.on(VectorDBEvents.INDEX_OFFLOADED, (event) => {
  console.log(`Index ${event.instanceId} offloaded with ${event.data.documentCount} documents`);
});

manager.on(VectorDBEvents.INDEX_RESUMED, (event) => {
  console.log(`Index ${event.instanceId} resumed from offload`);
});
```

## Hypha Service API

### Create Index with Activity Monitoring

```javascript
// Create index with custom timeout
const result = await hyphaService.createVectorIndex({
  id: "my-index",
  embeddingProviderName: "ollama-nomic-embed-text", // Use provider from registry
  inactivityTimeout: 3600000, // 1 hour
  enableActivityMonitoring: true
});
```

### Activity Management

```javascript
// Ping an index to reset timer
await hyphaService.pingVectorIndex({ indexId: "my-index" });

// Set timeout
await hyphaService.setVectorIndexTimeout({ 
  indexId: "my-index", 
  timeout: 7200000 // 2 hours
});

// Manual offload
await hyphaService.manualOffloadVectorIndex({ indexId: "my-index" });

// List offloaded indices
const offloaded = await hyphaService.listOffloadedVectorIndices();

// Delete offloaded index
await hyphaService.deleteOffloadedVectorIndex({ indexId: "my-index" });
```

### Enhanced Index Information

```javascript
// Get detailed index info including activity monitoring
const info = await hyphaService.getVectorIndexInfo({ indexId: "my-index" });
console.log(info.activityMonitoring);
// {
//   lastActivity: "2024-01-15T10:30:00.000Z",
//   timeUntilOffload: 1500000,
//   inactivityTimeout: 1800000,
//   enabled: true
// }
```

# Provider Registry Configuration

The VectorDBManager now supports initializing embedding providers through a configuration object passed to the constructor. This allows you to set up multiple embedding providers at once and reference them by name when creating indices.

## Features

- **Bulk Provider Registration**: Register multiple embedding providers at initialization
- **Named Provider References**: Reference providers by name when creating indices
- **Automatic Event Emission**: Provider addition events are automatically emitted during initialization
- **Type Safety**: Full TypeScript support with proper interfaces

## Interface

```typescript
export interface IProviderRegistryConfig {
  [providerId: string]: IEmbeddingProvider;
}

export interface IVectorDBManagerOptions {
  // ... existing options
  providerRegistry?: IProviderRegistryConfig; // New option
}
```

## Usage

### Basic Example

```typescript
import { 
  VectorDBManager, 
  createGenericEmbeddingProvider,
  IProviderRegistryConfig 
} from "./manager.ts";

// Create providers
const provider1 = createGenericEmbeddingProvider(
  "Provider 1",
  384,
  async (text: string) => {
    // Your embedding logic here
    return new Array(384).fill(0).map(() => Math.random());
  }
);

const provider2 = createGenericEmbeddingProvider(
  "Provider 2",
  512,
  async (text: string) => {
    // Different embedding logic
    return new Array(512).fill(0).map(() => Math.random());
  }
);

// Configure registry
const providerRegistry: IProviderRegistryConfig = {
  "my-provider-1": provider1,
  "my-provider-2": provider2
};

// Create manager with provider registry
const manager = new VectorDBManager({
  defaultEmbeddingProviderName: "my-provider-1", // Set default
  providerRegistry: providerRegistry
});
```

### Using Providers

```typescript
// Create index with default provider (my-provider-1)
const indexId1 = await manager.createIndex({
  namespace: "test"
});

// Create index with specific provider
const indexId2 = await manager.createIndex({
  namespace: "test",
  embeddingProviderName: "my-provider-2"
});

// Add documents (embeddings generated using specified providers)
await manager.addDocuments(indexId1, [
  { id: "doc1", text: "Document using provider 1" }
]);

await manager.addDocuments(indexId2, [
  { id: "doc2", text: "Document using provider 2" }
]);
```

### Ollama Provider Example

```typescript
import { createOllamaEmbeddingProvider } from "./manager.ts";

const ollamaProvider = createOllamaEmbeddingProvider(
  "Ollama Embeddings",
  "http://localhost:11434",
  "nomic-embed-text",
  768
);

const providerRegistry: IProviderRegistryConfig = {
  "ollama-nomic": ollamaProvider,
  "mock-provider": mockProvider
};

const manager = new VectorDBManager({
  defaultEmbeddingProviderName: "ollama-nomic",
  providerRegistry: providerRegistry
});
```

## Benefits

1. **Simplified Setup**: Configure all providers at once during initialization
2. **Consistent Naming**: Use meaningful names for providers across your application
3. **Default Provider**: Set a default provider that will be used when no specific provider is specified
4. **Event Tracking**: All provider additions are tracked and emit events for monitoring
5. **Runtime Management**: Still supports adding/removing providers at runtime using existing methods

## Migration

Existing code continues to work unchanged. The provider registry configuration is optional and additive to existing functionality.

```typescript
// Old way (still works)
const manager = new VectorDBManager();
manager.addEmbeddingProvider("my-provider", provider);

// New way (additional option)
const manager = new VectorDBManager({
  providerRegistry: {
    "my-provider": provider
  }
});
```

## Events

When providers are initialized from the registry configuration, `PROVIDER_ADDED` events are emitted for each provider, just like when using `addEmbeddingProvider()` manually.

```typescript
manager.on('provider_added', (event) => {
  console.log(`Provider added: ${event.data.name} (${event.data.type})`);
});
``` 

## File Structure

When indices are offloaded, they create files in the offload directory:

```
vectordb_offload/
├── workspace1:my-index.metadata.json    # Index metadata
├── workspace1:my-index.documents.json   # Document data
├── workspace2:other-index.metadata.json
└── workspace2:other-index.documents.json
```

### Metadata Format

```json
{
  "id": "workspace1:my-index",
  "created": "2024-01-15T09:00:00.000Z",
  "offloadedAt": "2024-01-15T10:30:00.000Z",
  "options": {
    "namespace": "workspace1",
    "embeddingProviderName": "ollama-nomic-embed-text",
    "enableActivityMonitoring": true,
    "inactivityTimeout": 1800000
  },
  "documentCount": 150,
  "embeddingDimension": 384,
  "documentsFile": "./vectordb_offload/workspace1:my-index.documents.json",
  "indexFile": "./vectordb_offload/workspace1:my-index.documents.json"
}
```

## Best Practices

### Timeout Configuration

- **Development**: Short timeouts (5-10 minutes) for quick iteration
- **Production**: Longer timeouts (30-60 minutes) to avoid unnecessary offloading
- **Persistent indices**: Disable activity monitoring for frequently used indices

### Resource Management

- Monitor the offload directory size
- Periodically clean up old offloaded indices
- Use appropriate timeouts based on usage patterns

### Performance Considerations

- Resuming from offload takes time (worker initialization + document loading)
- Consider keeping frequently accessed indices in memory
- Use ping functionality for long-running processes

## Example Usage

See `examples/vectordb-activity-monitoring.ts` for a complete demonstration of all features.

```bash
# Run the example
deno run --allow-read --allow-write --allow-net --allow-env examples/vectordb-activity-monitoring.ts
```

## Migration Guide

Existing VectorDB indices will continue to work without changes. To enable activity monitoring:

1. Update VectorDBManager configuration to include activity monitoring options
2. Optionally set `enableActivityMonitoring: true` when creating new indices
3. Configure appropriate timeouts based on your usage patterns

Activity monitoring is backward compatible and can be enabled/disabled at any time. 