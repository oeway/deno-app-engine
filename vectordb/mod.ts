// Vector Database Module for Deno App Engine
// Main module file that exports all vector database components

export {
  VectorDBManager,
  VectorDBEvents,
  VectorDBPermission,
  type IVectorDBInstance,
  type IVectorDBOptions,
  type IDocument,
  type IQueryOptions,
  type IQueryResult,
  type IVectorDBManagerOptions,
  type IEmbeddingProvider,
  type IEmbeddingProviderBase,
  type IGenericEmbeddingProvider,
  type IOllamaEmbeddingProvider,
  type IProviderRegistryEntry,
  createGenericEmbeddingProvider,
  createOllamaEmbeddingProvider
} from "./manager.ts";

// Re-export Voy for direct usage if needed
export { Voy } from "./voy_search.js"; 