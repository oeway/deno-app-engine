# Vector Database Module

A production-ready vector database module for the Deno App Engine that provides semantic search capabilities using the Voy search engine and Transformers.js embeddings.

> **Note**: Tests have been moved to the `tests/` folder for better organization. Use `deno task test-vectordb` to run unit tests.

## Features

- **Multi-instance Management**: Create and manage multiple vector database instances
- **Web Worker Isolation**: Each vector index runs in its own web worker for performance and isolation
- **Automatic Text Embedding**: Automatic text-to-vector conversion using Transformers.js
- **Namespace Support**: Workspace-based isolation for multi-tenant applications
- **Real-time Events**: Event-driven architecture with real-time notifications
- **Semantic Search**: High-performance vector similarity search using Voy
- **CRUD Operations**: Full create, read, update, delete operations for documents
- **Resource Management**: Automatic cleanup and resource leak prevention
- **Production Ready**: Comprehensive error handling and edge case management

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  VectorDBManager│    │   Web Workers    │    │  Voy Search     │
│                 │    │                  │    │  Engine         │
│ - Event System  │◄──►│ - Vector Ops     │◄──►│                 │
│ - Embeddings    │    │ - Document Store │    │ - k-NN Search   │
│ - Namespaces    │    │ - Query Handler  │    │ - Serialization │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Quick Start

```typescript
import { VectorDBManager, type IDocument } from "./vectordb/mod.ts";

// Create manager
const manager = new VectorDBManager({
  defaultEmbeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
  maxInstances: 10
});

// Create vector index
const indexId = await manager.createIndex({
  id: "my-documents",
  namespace: "workspace1"
});

// Add documents
const documents: IDocument[] = [
  {
    id: "doc1",
    text: "Machine learning is transforming technology",
    metadata: { category: "AI", author: "John" }
  },
  {
    id: "doc2", 
    text: "Vector databases enable semantic search",
    metadata: { category: "Database", author: "Jane" }
  }
];

await manager.addDocuments(indexId, documents);

// Query documents
const results = await manager.queryIndex(
  indexId, 
  "artificial intelligence", 
  { k: 5, includeMetadata: true }
);

console.log("Search results:", results);
```

## API Reference

### VectorDBManager

#### Constructor Options

```typescript
interface IVectorDBManagerOptions {
  defaultEmbeddingModel?: string;  // Default: "mixedbread-ai/mxbai-embed-xsmall-v1"
  maxInstances?: number;           // Default: 50
  allowedNamespaces?: string[];    // Optional namespace restrictions
}
```

#### Methods

##### `createIndex(options: IVectorDBOptions): Promise<string>`

Creates a new vector database index.

```typescript
const indexId = await manager.createIndex({
  id: "documents",
  namespace: "workspace1",
  embeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1"
});
```

##### `addDocuments(instanceId: string, documents: IDocument[]): Promise<void>`

Adds documents to a vector index.

```typescript
await manager.addDocuments(indexId, [
  { id: "doc1", text: "Document content", metadata: { type: "article" } }
]);
```

##### `queryIndex(instanceId: string, query: string | number[], options?: IQueryOptions): Promise<IQueryResult[]>`

Queries a vector index with text or vector.

```typescript
const results = await manager.queryIndex(indexId, "search query", {
  k: 10,
  threshold: 0.7,
  includeMetadata: true
});
```

##### `removeDocuments(instanceId: string, documentIds: string[]): Promise<void>`

Removes documents from a vector index.

```typescript
await manager.removeDocuments(indexId, ["doc1", "doc2"]);
```

##### `destroyIndex(instanceId: string): Promise<void>`

Destroys a vector index and cleans up resources.

```typescript
await manager.destroyIndex(indexId);
```

##### `listInstances(namespace?: string): Array<InstanceInfo>`

Lists all vector database instances, optionally filtered by namespace.

```typescript
const instances = manager.listInstances("workspace1");
```

##### `getStats(): ManagerStats`

Gets statistics about the vector database manager.

```typescript
const stats = manager.getStats();
console.log(`Total instances: ${stats.totalInstances}`);
```

### Events

The VectorDBManager emits events for all operations:

```typescript
import { VectorDBEvents } from "./vectordb/mod.ts";

manager.on(VectorDBEvents.INDEX_CREATED, (event) => {
  console.log(`Index created: ${event.instanceId}`);
});

manager.on(VectorDBEvents.DOCUMENT_ADDED, (event) => {
  console.log(`Added ${event.data.count} documents`);
});

manager.on(VectorDBEvents.QUERY_COMPLETED, (event) => {
  console.log(`Query returned ${event.data.resultCount} results`);
});
```

Available events:
- `INDEX_CREATED`
- `INDEX_DESTROYED` 
- `DOCUMENT_ADDED`
- `DOCUMENT_REMOVED`
- `QUERY_COMPLETED`
- `ERROR`

## Data Types

### IDocument

```typescript
interface IDocument {
  id: string;
  text?: string;           // Text content (will be embedded automatically)
  vector?: number[];       // Pre-computed vector (384 dimensions)
  metadata?: Record<string, any>;  // Optional metadata
}
```

### IQueryOptions

```typescript
interface IQueryOptions {
  k?: number;              // Number of results to return (default: 10)
  threshold?: number;      // Similarity threshold (default: 0)
  includeMetadata?: boolean; // Include metadata in results (default: true)
}
```

### IQueryResult

```typescript
interface IQueryResult {
  id: string;
  score: number;           // Similarity score (0-1)
  metadata?: Record<string, any>;
  text?: string;
}
```

## Embedding Models

The module supports any Transformers.js compatible embedding model. Recommended models:

- **mixedbread-ai/mxbai-embed-xsmall-v1** (384 dimensions) - Default, fast and efficient
- **sentence-transformers/all-MiniLM-L6-v2** (384 dimensions) - Good general purpose
- **sentence-transformers/all-mpnet-base-v2** (768 dimensions) - Higher quality

For testing, use `"mock-model"` to generate deterministic mock embeddings.

## Namespace Support

Namespaces provide workspace isolation:

```typescript
// Create indices in different namespaces
const workspace1Index = await manager.createIndex({
  id: "docs",
  namespace: "workspace1"
});

const workspace2Index = await manager.createIndex({
  id: "docs", 
  namespace: "workspace2"
});

// List instances by namespace
const workspace1Instances = manager.listInstances("workspace1");
```

## Performance Considerations

- **Batch Operations**: Add documents in batches for better performance
- **Worker Isolation**: Each index runs in a separate web worker
- **Memory Management**: Automatic cleanup prevents memory leaks
- **Embedding Caching**: Embeddings are generated once and cached
- **Concurrent Operations**: Supports concurrent queries across indices

## Testing

The module includes comprehensive tests:

```bash
# Run unit tests (mock embeddings)
deno task test-vectordb

# Run integration tests
deno task test-vectordb-integration

# Run stress tests
deno task test-vectordb-stress

# Run all tests including vector database
deno task test
```

## Error Handling

The module provides comprehensive error handling:

- **Instance Limits**: Enforces maximum number of instances
- **Duplicate IDs**: Prevents duplicate index creation
- **Invalid Documents**: Validates document structure
- **Resource Cleanup**: Automatic cleanup on errors
- **Timeout Handling**: Configurable timeouts for operations

## Integration with Hypha Service

The vector database integrates seamlessly with the Hypha service:

```typescript
// In hypha-service.ts
const vectorDBManager = new VectorDBManager({
  defaultEmbeddingModel: "mixedbread-ai/mxbai-embed-xsmall-v1",
  maxInstances: 100
});

// Service methods automatically handle namespaces
async createVectorIndex(options, context) {
  return await vectorDBManager.createIndex({
    ...options,
    namespace: context.ws  // Workspace isolation
  });
}
```

## Troubleshooting

### Common Issues

1. **Threading Issues with Transformers.js**
   - Use mock embeddings for testing: `defaultEmbeddingModel: "mock-model"`
   - Real embeddings may have mutex lock issues in some Deno environments

2. **Voy Search Engine Errors**
   - Ensure embeddings are diverse enough (avoid identical vectors)
   - Use smaller batch sizes for large datasets
   - Check embedding dimensions match (384 for default model)

3. **Memory Issues**
   - Monitor instance count and document count
   - Use `destroyAll()` for cleanup in tests
   - Set appropriate `maxInstances` limit

### Debug Mode

Enable debug logging:

```typescript
const manager = new VectorDBManager({
  defaultEmbeddingModel: "mock-model", // For debugging
  maxInstances: 5
});

// Monitor events
manager.on(VectorDBEvents.ERROR, (event) => {
  console.error("VectorDB Error:", event);
});
```

## License

This module is part of the Deno App Engine project and follows the same license terms. 