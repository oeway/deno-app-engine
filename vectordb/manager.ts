// Vector Database Manager for Deno App Engine
// This file manages vector database instances in web workers

// @ts-ignore Import Comlink from Deno
import * as Comlink from "https://deno.land/x/comlink@4.4.1/mod.ts";
import { EventEmitter } from "https://deno.land/std@0.177.0/node/events.ts";
import { ensureDir, exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { Ollama } from "npm:ollama";
import type { IVectorDBWorkerAPI } from "./worker.ts";

// Vector database events
export enum VectorDBEvents {
  INDEX_CREATED = "index_created",
  INDEX_DESTROYED = "index_destroyed",
  INDEX_OFFLOADED = "index_offloaded",
  INDEX_RESUMED = "index_resumed",
  DOCUMENT_ADDED = "document_added",
  DOCUMENT_REMOVED = "document_removed",
  QUERY_COMPLETED = "query_completed",
  ERROR = "error",
  PROVIDER_ADDED = "provider_added",
  PROVIDER_REMOVED = "provider_removed",
  PROVIDER_UPDATED = "provider_updated"
}

// Base interface for embedding providers
export interface IEmbeddingProviderBase {
  embed(text: string): Promise<number[]>;
  dimension: number;
  name: string;
}

// Generic embedding provider
export interface IGenericEmbeddingProvider extends IEmbeddingProviderBase {
  type: "generic";
}

// Ollama embedding provider
export interface IOllamaEmbeddingProvider extends IEmbeddingProviderBase {
  type: "ollama";
  ollamaHost: string;
  embeddingModel: string;
}

// Union type for all embedding providers
export type IEmbeddingProvider = IGenericEmbeddingProvider | IOllamaEmbeddingProvider;

// Interface for vector database instance
export interface IVectorDBInstance {
  id: string;
  worker: Worker;
  created: Date;
  options: IVectorDBOptions;
  documentCount: number;
  embeddingDimension?: number;
  isFromOffload?: boolean; // Track if this instance was resumed from offload
  destroy(): Promise<void>;
}

// Interface for vector database options
export interface IVectorDBOptions {
  id?: string;
  namespace?: string;
  embeddingModel?: string;
  embeddingProvider?: IEmbeddingProvider;
  embeddingProviderName?: string; // Name of provider from registry
  maxDocuments?: number;
  persistData?: boolean;
  inactivityTimeout?: number; // Time in milliseconds after which an inactive index will be offloaded
  enableActivityMonitoring?: boolean; // Whether to monitor activity and auto-offload
  resume?: boolean; // Whether to resume an existing index or create a new one
}

// Interface for document to be added
export interface IDocument {
  id: string;
  text?: string;
  vector?: number[];
  metadata?: Record<string, any>;
}

// Interface for query options
export interface IQueryOptions {
  k?: number; // Number of results to return
  threshold?: number; // Similarity threshold
  includeMetadata?: boolean;
}

// Interface for query result
export interface IQueryResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
  text?: string;
}

// Interface for manager options
export interface IVectorDBManagerOptions {
  defaultEmbeddingModel?: string;
  defaultEmbeddingProvider?: IEmbeddingProvider;
  defaultEmbeddingProviderName?: string; // Name of default provider from registry
  maxInstances?: number;
  allowedNamespaces?: string[];
  offloadDirectory?: string; // Directory to store offloaded indices
  defaultInactivityTimeout?: number; // Default inactivity timeout for new indices
  enableActivityMonitoring?: boolean; // Global flag to enable activity monitoring
  providerRegistry?: IProviderRegistryConfig; // Initial provider registry configuration
}

// Interface for offloaded index metadata
interface IOffloadedIndexMetadata {
  id: string;
  created: Date;
  offloadedAt: Date;
  options: IVectorDBOptions;
  documentCount: number;
  embeddingDimension?: number;
  documentsFile: string; // Path to the documents file (text + metadata)
  vectorsFile: string; // Path to the binary vectors file
  indexFile: string; // Path to the index file (for compatibility)
  format: "binary_v1"; // Format version for future compatibility
}

// Interface for provider registry entry
export interface IProviderRegistryEntry {
  id: string;
  provider: IEmbeddingProvider;
  created: Date;
  lastUsed?: Date;
}

// Interface for provider registry configuration
export interface IProviderRegistryConfig {
  [providerId: string]: IEmbeddingProvider;
}

// Helper functions to create embedding providers
export function createGenericEmbeddingProvider(
  name: string,
  dimension: number,
  embedFunction: (text: string) => Promise<number[]>
): IGenericEmbeddingProvider {
  return {
    type: "generic",
    name,
    dimension,
    embed: embedFunction
  };
}

export function createOllamaEmbeddingProvider(
  name: string,
  ollamaHost: string,
  embeddingModel: string,
  dimension: number
): IOllamaEmbeddingProvider {
  // Create Ollama client
  const ollama = new Ollama({ host: ollamaHost });
  
  // Create embed function that uses Ollama
  const embedFunction = async (text: string): Promise<number[]> => {
    try {
      const response = await ollama.embed({
        model: embeddingModel,
        input: text
      });
      
      if (!response.embeddings || response.embeddings.length === 0) {
        throw new Error("No embeddings returned from Ollama");
      }
      
      return response.embeddings[0];
    } catch (error) {
      console.error(`Ollama embedding error for model ${embeddingModel}:`, error);
      throw new Error(`Failed to generate embedding with Ollama: ${error}`);
    }
  };
  
  return {
    type: "ollama",
    name,
    ollamaHost,
    embeddingModel,
    dimension,
    embed: embedFunction
  };
}

/**
 * VectorDBManager class manages multiple vector database instances 
 * running in web workers with activity monitoring and offloading
 */
export class VectorDBManager extends EventEmitter {
  private instances: Map<string, IVectorDBInstance> = new Map();
  private embeddingModel: string;
  private defaultEmbeddingProvider?: IEmbeddingProvider;
  private defaultEmbeddingProviderName?: string;
  private maxInstances: number;
  private allowedNamespaces?: string[];
  
  // Provider registry
  private providerRegistry: Map<string, IProviderRegistryEntry> = new Map();
  
  // Activity monitoring
  private lastActivityTime: Map<string, number> = new Map();
  private inactivityTimers: Map<string, number> = new Map();
  private offloadDirectory: string;
  private defaultInactivityTimeout: number;
  private enableActivityMonitoring: boolean;
  
  constructor(options: IVectorDBManagerOptions = {}) {
    super();
    super.setMaxListeners(100);
    
    this.embeddingModel = options.defaultEmbeddingModel || "mock-model";
    this.defaultEmbeddingProvider = options.defaultEmbeddingProvider;
    this.defaultEmbeddingProviderName = options.defaultEmbeddingProviderName;
    this.maxInstances = options.maxInstances || 50;
    this.allowedNamespaces = options.allowedNamespaces;
    
    // Activity monitoring configuration
    this.offloadDirectory = options.offloadDirectory || "./vectordb_offload";
    this.defaultInactivityTimeout = options.defaultInactivityTimeout || 1000 * 60 * 30; // 30 minutes default
    this.enableActivityMonitoring = options.enableActivityMonitoring !== false; // Default true
    
    // Initialize provider registry from config
    this.initializeProviderRegistry(options.providerRegistry);
    
    // Ensure offload directory exists
    this.ensureOffloadDirectory();
  }
  
  /**
   * Initialize the provider registry from configuration
   * @param config Provider registry configuration
   * @private
   */
  private initializeProviderRegistry(config?: IProviderRegistryConfig): void {
    if (!config) {
      return;
    }
    
    const now = new Date();
    
    for (const [providerId, provider] of Object.entries(config)) {
      const entry: IProviderRegistryEntry = {
        id: providerId,
        provider,
        created: now
      };
      
      this.providerRegistry.set(providerId, entry);
      
      console.log(`📝 Initialized embedding provider: ${providerId} (${provider.type}: ${provider.name})`);
      
      // Emit provider added event
      this.emit(VectorDBEvents.PROVIDER_ADDED, {
        providerId,
        data: { 
          id: providerId, 
          type: provider.type,
          name: provider.name,
          dimension: provider.dimension,
          created: now
        }
      });
    }
    
    if (Object.keys(config).length > 0) {
      console.log(`✅ Initialized ${Object.keys(config).length} embedding provider(s) from configuration`);
    }
  }

  /**
   * Ensure the offload directory exists
   * @private
   */
  private async ensureOffloadDirectory(): Promise<void> {
    try {
      await ensureDir(this.offloadDirectory);
      console.log(`📁 Offload directory ensured: ${this.offloadDirectory}`);
    } catch (error) {
      console.error(`❌ Failed to create offload directory: ${error}`);
      throw new Error(`Failed to create offload directory: ${error}`);
    }
  }
  

  
  /**
   * Generate embeddings for text using the appropriate provider
   * @param text Text to embed
   * @param embeddingProvider Optional specific embedding provider for this operation
   * @param embeddingProviderName Optional provider name from registry
   * @returns Promise resolving to embedding vector
   * @private
   */
  private async generateEmbedding(
    text: string, 
    embeddingProvider?: IEmbeddingProvider,
    embeddingProviderName?: string
  ): Promise<number[]> {
    // Priority: specific provider > provider name from registry > default provider name > default provider > mock model
    let provider = embeddingProvider;
    
    // If no specific provider but we have a provider name, get it from registry
    if (!provider && embeddingProviderName) {
      const registryEntry = this.providerRegistry.get(embeddingProviderName);
      if (registryEntry) {
        provider = registryEntry.provider;
        // Update last used time
        registryEntry.lastUsed = new Date();
      }
    }
    
    // If still no provider, try default provider name from registry
    if (!provider && this.defaultEmbeddingProviderName) {
      const registryEntry = this.providerRegistry.get(this.defaultEmbeddingProviderName);
      if (registryEntry) {
        provider = registryEntry.provider;
        registryEntry.lastUsed = new Date();
      }
      else{
        throw new Error(`Embedding provider ${this.defaultEmbeddingProviderName} not found in registry`);
      }
    }
    
    // If still no provider, use default provider
    if (!provider) {
      provider = this.defaultEmbeddingProvider;
    }
    
    if (provider) {
      try {
        return await provider.embed(text);
      } catch (error) {
        console.error(`Failed to generate embedding using provider: ${provider.name}`);
        throw error;
      }
    }
    
    // For mock model, use a simple deterministic embedding
    if (this.embeddingModel === "mock-model") {
      return this.createMockEmbedding(text);
    }
    
    // If no provider is available, throw an error
    throw new Error("No embedding provider available. Please configure an embedding provider or use mock-model.");
  }
  
  /**
   * Create a mock embedding for testing
   * @param text Text to embed
   * @returns Mock embedding vector
   * @private
   */
  private createMockEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(384).fill(0);
    
    // Create a more diverse hash by including text length and random seed
    const textHash = text.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    // Add randomness based on text content to avoid identical embeddings
    const seed = Math.abs(textHash) % 1000000;
    
    // Simple hash-based embedding with more diversity
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const charCode = word.charCodeAt(j);
        const index = (charCode + i * 37 + j * 13 + seed) % 384;
        embedding[index] += 0.1 + (seed % 100) / 1000; // Add small variation
      }
    }
    
    // Add some random noise to ensure uniqueness
    for (let i = 0; i < 384; i += 10) {
      const noiseIndex = (seed + i) % 384;
      embedding[noiseIndex] += (Math.sin(seed + i) * 0.05);
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }
  
  /**
   * Update activity timestamp for an instance and reset inactivity timer if present
   * @param id Instance ID
   * @private
   */
  private updateInstanceActivity(id: string): void {
    // Update the last activity time
    this.lastActivityTime.set(id, Date.now());
    
    // Get the instance options
    const instance = this.instances.get(id);
    if (!instance) return;
    
    // Check if activity monitoring is enabled for this instance
    const activityMonitoringEnabled = instance.options.enableActivityMonitoring !== false && this.enableActivityMonitoring;
    const timeout = instance.options.inactivityTimeout || this.defaultInactivityTimeout;
    
    // Reset the inactivity timer if activity monitoring is enabled and timeout is greater than 0
    if (activityMonitoringEnabled && timeout && timeout > 0) {
      this.setupInactivityTimeout(id, timeout);
    }
  }

  /**
   * Set up an inactivity timeout for an instance
   * @param id Instance ID
   * @param timeout Timeout in milliseconds
   * @private
   */
  private setupInactivityTimeout(id: string, timeout: number): void {
    // Don't set up a timer if timeout is 0 or negative
    if (timeout <= 0) {
      return;
    }
    
    // Always clear any existing timer first
    this.clearInactivityTimeout(id);
    
    // Create a timer to offload the instance after the timeout
    const timer = setTimeout(() => {
      this.offloadInstance(id).catch(error => {
        console.error(`Error offloading inactive instance ${id}:`, error);
      });
    }, timeout);
    
    // Store the timer ID
    this.inactivityTimers.set(id, timer);
  }
  
  /**
   * Clear any existing inactivity timeout for an instance
   * @param id Instance ID
   * @private
   */
  private clearInactivityTimeout(id: string): void {
    if (this.inactivityTimers.has(id)) {
      const timerId = this.inactivityTimers.get(id);
      clearTimeout(timerId);
      this.inactivityTimers.delete(id);
    }
  }

  /**
   * Check if an offloaded index exists for the given ID
   * @param id Instance ID
   * @returns Promise resolving to true if offloaded index exists
   * @private
   */
  private async hasOffloadedIndex(id: string): Promise<boolean> {
    const metadataPath = join(this.offloadDirectory, `${id}.metadata.json`);
    return await exists(metadataPath);
  }

  /**
   * Resume an instance from offloaded data
   * @param id Instance ID
   * @param options Additional options to override
   * @returns Promise resolving to the resumed instance
   * @private
   */
  private async resumeFromOffload(id: string, options: IVectorDBOptions = {}): Promise<IVectorDBInstance> {
    const metadataPath = join(this.offloadDirectory, `${id}.metadata.json`);
    
    try {
      // Read metadata
      const metadataContent = await Deno.readTextFile(metadataPath);
      const metadata: IOffloadedIndexMetadata = JSON.parse(metadataContent);
      
      console.log(`📂 Resuming instance ${id} from offload...`);
      
      // Create worker
      const worker = new Worker(
        new URL("./worker.ts", import.meta.url).href,
        { type: "module" }
      );
      
      // Create a proxy to the worker using Comlink
      const workerProxy = Comlink.wrap<IVectorDBWorkerAPI>(worker);
      
      // Merge options with metadata options, giving priority to new options
      const mergedOptions = { ...metadata.options, ...options };
      
      // Initialize the worker (exclude embeddingProvider as it can't be serialized)
      const { embeddingProvider, ...serializableOptions } = mergedOptions;
      await workerProxy.initialize({
        id,
        embeddingModel: this.embeddingModel,
        ...serializableOptions
      });
      
      // Load documents from offload - handle both binary and legacy formats
      let documents: IDocument[] = [];
      
      if (metadata.format === "binary_v1" && metadata.vectorsFile) {
        // New binary format - read documents and vectors separately
        const lightweightDocs = await this.readDocumentsJson(metadata.documentsFile);
        const vectors = await this.readVectorsBinary(metadata.vectorsFile);
        
        // Combine documents with their vectors
        documents = lightweightDocs.map(doc => ({
          id: doc.id,
          text: doc.text,
          metadata: doc.metadata,
          vector: vectors.get(doc.id)
        }));
      } else {
        // Legacy JSON format - read documents directly
        const documentsContent = await Deno.readTextFile(metadata.documentsFile);
        documents = JSON.parse(documentsContent);
      }
      
      if (documents.length > 0) {
        // Add documents back to the worker
        const result = await workerProxy.addDocuments(documents);
        if (!result.success) {
          throw new Error(result.error || "Failed to add documents during resume");
        }
      }
      
      // Create the instance with Comlink proxy
      const instance: IVectorDBInstance = {
        id,
        worker,
        created: metadata.created,
        options: mergedOptions,
        documentCount: metadata.documentCount,
        embeddingDimension: metadata.embeddingDimension,
        isFromOffload: true,
        destroy: async () => {
          workerProxy[Comlink.releaseProxy]();
          worker.terminate();
        }
      };
      
      // Store the proxy for later use
      (instance as any).proxy = workerProxy;
      
      console.log(`✅ Instance ${id} resumed from offload with ${metadata.documentCount} documents`);
      
      // Emit resume event
      this.emit(VectorDBEvents.INDEX_RESUMED, {
        instanceId: id,
        data: { 
          id, 
          documentCount: metadata.documentCount,
          offloadedAt: metadata.offloadedAt,
          resumedAt: new Date()
        }
      });
      
      return instance;
      
    } catch (error) {
      console.error(`❌ Failed to resume instance ${id} from offload:`, error);
      throw new Error(`Failed to resume instance from offload: ${error}`);
    }
  }

  /**
   * Offload an instance to disk
   * @param id Instance ID
   * @returns Promise resolving when instance is offloaded
   * @private
   */
  private async offloadInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      console.warn(`Cannot offload instance ${id}: instance not found`);
      return;
    }
    
    try {
      console.log(`💾 Offloading instance ${id} to disk...`);
      
      // Get the worker proxy
      const workerProxy = (instance as any).proxy as Comlink.Remote<IVectorDBWorkerAPI>;
      
      // Get all documents from the worker
      const result = await workerProxy.getDocuments();
      
      if (!result.success) {
        throw new Error(result.error || "Failed to get documents");
      }
      
      const documents = result.documents!;
      
      // Create file paths
      const documentsFile = join(this.offloadDirectory, `${id}.documents.json`);
      const metadataFile = join(this.offloadDirectory, `${id}.metadata.json`);
      
      // Create metadata
      const metadata: IOffloadedIndexMetadata = {
        id,
        created: instance.created,
        offloadedAt: new Date(),
        options: instance.options,
        documentCount: instance.documentCount,
        embeddingDimension: instance.embeddingDimension,
        documentsFile,
        vectorsFile: join(this.offloadDirectory, `${id}.vectors.bin`),
        indexFile: documentsFile, // For now, we store documents as the index
        format: "binary_v1"
      };
      
      // Write documents to disk
      await this.writeDocumentsJson(documentsFile, documents);
      
      // Write vectors to binary format for efficient storage
      await this.writeVectorsBinary(metadata.vectorsFile, documents, instance.embeddingDimension || 0);
      
      // Write metadata to disk
      await Deno.writeTextFile(metadataFile, JSON.stringify(metadata, null, 2));
      
      // Clear any inactivity timer
      this.clearInactivityTimeout(id);
      
      // Clean up activity tracking
      this.lastActivityTime.delete(id);
      
      // Destroy the instance
      await instance.destroy();
      
      // Remove from map
      this.instances.delete(id);
      
      console.log(`✅ Instance ${id} offloaded successfully with ${documents.length} documents`);
      
      // Emit offload event
      this.emit(VectorDBEvents.INDEX_OFFLOADED, {
        instanceId: id,
        data: { 
          id, 
          documentCount: documents.length,
          offloadedAt: metadata.offloadedAt,
          offloadPath: this.offloadDirectory
        }
      });
      
    } catch (error) {
      console.error(`❌ Failed to offload instance ${id}:`, error);
      throw new Error(`Failed to offload instance: ${error}`);
    }
  }

  /**
   * Write vectors to binary format for efficient storage
   * @param filePath Path to write the binary file
   * @param documents Documents with vectors
   * @param embeddingDimension Dimension of the vectors
   * @private
   */
  private async writeVectorsBinary(filePath: string, documents: IDocument[], embeddingDimension: number): Promise<void> {
    // Calculate total size needed
    // Header: 4 bytes (doc count) + 4 bytes (dimension)
    // For each document: 4 bytes (id length) + id bytes + vector bytes (dimension * 4 bytes per float32)
    let totalSize = 8; // Header
    
    for (const doc of documents) {
      if (doc.vector) {
        totalSize += 4; // ID length
        totalSize += new TextEncoder().encode(doc.id).length; // ID bytes
        totalSize += embeddingDimension * 4; // Vector bytes (float32)
      }
    }
    
    // Create buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const encoder = new TextEncoder();
    
    let offset = 0;
    
    // Write header
    view.setUint32(offset, documents.filter(d => d.vector).length, true); // Document count with vectors
    offset += 4;
    view.setUint32(offset, embeddingDimension, true); // Embedding dimension
    offset += 4;
    
    // Write documents with vectors
    for (const doc of documents) {
      if (doc.vector && doc.vector.length === embeddingDimension) {
        // Write document ID length and ID
        const idBytes = encoder.encode(doc.id);
        view.setUint32(offset, idBytes.length, true);
        offset += 4;
        
        // Write ID bytes
        const idArray = new Uint8Array(buffer, offset, idBytes.length);
        idArray.set(idBytes);
        offset += idBytes.length;
        
        // Write vector as float32 array
        for (let i = 0; i < embeddingDimension; i++) {
          view.setFloat32(offset, doc.vector[i], true);
          offset += 4;
        }
      }
    }
    
    // Write to file
    await Deno.writeFile(filePath, new Uint8Array(buffer));
  }

  /**
   * Read vectors from binary format
   * @param filePath Path to the binary file
   * @returns Map of document ID to vector
   * @private
   */
  private async readVectorsBinary(filePath: string): Promise<Map<string, number[]>> {
    const data = await Deno.readFile(filePath);
    const buffer = data.buffer;
    const view = new DataView(buffer);
    const decoder = new TextDecoder();
    
    let offset = 0;
    
    // Read header
    const docCount = view.getUint32(offset, true);
    offset += 4;
    const embeddingDimension = view.getUint32(offset, true);
    offset += 4;
    
    const vectors = new Map<string, number[]>();
    
    // Read documents
    for (let i = 0; i < docCount; i++) {
      // Read document ID
      const idLength = view.getUint32(offset, true);
      offset += 4;
      
      const idBytes = new Uint8Array(buffer, offset, idLength);
      const id = decoder.decode(idBytes);
      offset += idLength;
      
      // Read vector
      const vector = new Array(embeddingDimension);
      for (let j = 0; j < embeddingDimension; j++) {
        vector[j] = view.getFloat32(offset, true);
        offset += 4;
      }
      
      vectors.set(id, vector);
    }
    
    return vectors;
  }

  /**
   * Write document text and metadata to JSON format
   * @param filePath Path to write the JSON file
   * @param documents Documents to write
   * @private
   */
  private async writeDocumentsJson(filePath: string, documents: IDocument[]): Promise<void> {
    // Create a lightweight version without vectors for JSON storage
    const lightweightDocs = documents.map(doc => ({
      id: doc.id,
      text: doc.text,
      metadata: doc.metadata,
      hasVector: !!doc.vector
    }));
    
    await Deno.writeTextFile(filePath, JSON.stringify(lightweightDocs, null, 2));
  }

  /**
   * Read document text and metadata from JSON format
   * @param filePath Path to the JSON file
   * @returns Array of documents without vectors
   * @private
   */
  private async readDocumentsJson(filePath: string): Promise<Array<{id: string, text?: string, metadata?: Record<string, any>, hasVector: boolean}>> {
    const content = await Deno.readTextFile(filePath);
    return JSON.parse(content);
  }

  /**
   * Create a new vector database instance
   * @param options Options for creating the database
   * @returns Promise resolving to the database instance ID
   */
  public async createIndex(options: IVectorDBOptions = {}): Promise<string> {
    // Check instance limit
    if (this.instances.size >= this.maxInstances) {
      throw new Error(`Maximum number of vector database instances (${this.maxInstances}) reached`);
    }
    
    const baseId = options.id || crypto.randomUUID();
    const namespace = options.namespace;
    const resume = options.resume || false;
    
    // Check namespace permissions
    if (this.allowedNamespaces && namespace && !this.allowedNamespaces.includes(namespace)) {
      throw new Error(`Namespace ${namespace} is not allowed`);
    }
    
    // Apply namespace prefix if provided
    const id = namespace ? `${namespace}:${baseId}` : baseId;
    
    // Check if instance with this ID already exists in memory
    if (this.instances.has(id)) {
      if (resume) {
        throw new Error(`Vector database with ID ${id} is already running in memory`);
      } else {
        throw new Error(`Vector database with ID ${id} already exists`);
      }
    }
    
    // Check if there's an offloaded index for this ID
    const hasOffloaded = await this.hasOffloadedIndex(id);
    
    if (resume) {
      // If resume=true, the index must exist (either in memory or offloaded)
      if (!hasOffloaded) {
        throw new Error(`Cannot resume: Vector database with ID ${id} does not exist`);
      }
    } else {
      // If resume=false or not set, we're creating a new index
      if (hasOffloaded) {
        throw new Error(`Vector database with ID ${id} already exists. Use resume=true to resume the existing index`);
      }
    }
    
    // Resolve embedding provider from registry if embeddingProviderName is specified
    if (options.embeddingProviderName && !options.embeddingProvider) {
      const providerEntry = this.providerRegistry.get(options.embeddingProviderName);
      if (!providerEntry) {
        throw new Error(`Embedding provider ${options.embeddingProviderName} not found in registry`);
      }
      options.embeddingProvider = providerEntry.provider;
      // Update last used time
      providerEntry.lastUsed = new Date();
    }

    if (hasOffloaded) {
      console.log(`📂 Found offloaded index for ${id}, resuming...`);
      
      // Resume from offload
      const instance = await this.resumeFromOffload(id, options);
      
      // Store the instance
      this.instances.set(id, instance);
      
      // Initialize activity tracking
      this.updateInstanceActivity(id);
      
      // Set up inactivity timeout if specified and activity monitoring is enabled
      const activityMonitoringEnabled = instance.options.enableActivityMonitoring !== false && this.enableActivityMonitoring;
      const timeout = instance.options.inactivityTimeout || this.defaultInactivityTimeout;
      
      if (activityMonitoringEnabled && timeout && timeout > 0) {
        this.setupInactivityTimeout(id, timeout);
      }
      
      return id;
    }
    
    // Create worker
    const worker = new Worker(
      new URL("./worker.ts", import.meta.url).href,
      { type: "module" }
    );
    
    // Create a proxy to the worker using Comlink
    const workerProxy = Comlink.wrap<IVectorDBWorkerAPI>(worker);
    
    // Initialize the worker (exclude embeddingProvider as it can't be serialized)
    const { embeddingProvider, ...serializableOptions } = options;
    await workerProxy.initialize({
      id,
      embeddingModel: this.embeddingModel,
      ...serializableOptions
    });
    
    // Create the instance with Comlink proxy
    const instance: IVectorDBInstance = {
      id,
      worker,
      created: new Date(),
      options,
      documentCount: 0,
      destroy: async () => {
        workerProxy[Comlink.releaseProxy]();
        worker.terminate();
      }
    };
    
    // Store the proxy for later use
    (instance as any).proxy = workerProxy;
    
    // Store the instance
    this.instances.set(id, instance);
    
    // Initialize activity tracking
    this.updateInstanceActivity(id);
    
    // Set up inactivity timeout if specified and activity monitoring is enabled
    const activityMonitoringEnabled = options.enableActivityMonitoring !== false && this.enableActivityMonitoring;
    const timeout = options.inactivityTimeout || this.defaultInactivityTimeout;
    
    if (activityMonitoringEnabled && timeout && timeout > 0) {
      this.setupInactivityTimeout(id, timeout);
    }
    
    // Emit creation event
    this.emit(VectorDBEvents.INDEX_CREATED, {
      instanceId: id,
      data: { id, created: instance.created }
    });
    
    return id;
  }
  
  /**
   * Get a vector database instance by ID
   * @param id Instance ID
   * @returns Instance or undefined if not found
   */
  public getInstance(id: string): IVectorDBInstance | undefined {
    return this.instances.get(id);
  }
  
  /**
   * Get list of all instance IDs
   * @returns Array of instance IDs
   */
  public getInstanceIds(): string[] {
    return Array.from(this.instances.keys());
  }
  
  /**
   * List all instances with their details
   * @param namespace Optional namespace to filter by
   * @returns Array of instance information
   */
  public listInstances(namespace?: string): Array<{
    id: string;
    created: Date;
    documentCount: number;
    embeddingDimension?: number;
    namespace?: string;
  }> {
    return Array.from(this.instances.entries())
      .filter(([id]) => {
        if (!namespace) return true;
        return id.startsWith(`${namespace}:`);
      })
      .map(([id, instance]) => {
        const namespaceMatch = id.match(/^([^:]+):/);
        const extractedNamespace = namespaceMatch ? namespaceMatch[1] : undefined;
        
        return {
          id,
          created: instance.created,
          documentCount: instance.documentCount,
          embeddingDimension: instance.embeddingDimension,
          namespace: extractedNamespace
        };
      });
  }
  
  /**
   * Add documents to a vector database
   * @param instanceId Instance ID
   * @param documents Documents to add
   * @returns Promise resolving when documents are added
   */
  public async addDocuments(instanceId: string, documents: IDocument[]): Promise<void> {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Vector database instance ${instanceId} not found`);
    }
    
    // Update activity
    this.updateInstanceActivity(instanceId);
    
    // Get the embedding provider for this instance
    const embeddingProvider = instance.options.embeddingProvider;
    const embeddingProviderName = instance.options.embeddingProviderName;
    
    // Process documents and generate embeddings for text-only documents
    const processedDocuments = await Promise.all(
      documents.map(async (doc) => {
        if (doc.vector) {
          // Document already has vector
          return doc;
        } else if (doc.text) {
          // Generate embedding for text using the appropriate provider
          const vector = await this.generateEmbedding(doc.text, embeddingProvider, embeddingProviderName);
          return { ...doc, vector };
        } else {
          throw new Error(`Document ${doc.id} must have either text or vector`);
        }
      })
    );
    
    // Get the worker proxy
    const workerProxy = (instance as any).proxy as Comlink.Remote<IVectorDBWorkerAPI>;
    
    // Send to worker using Comlink proxy
    const result = await workerProxy.addDocuments(processedDocuments);
    
    if (result.success) {
      // Update document count
      instance.documentCount += processedDocuments.length;
      
      // Update embedding dimension if not set
      if (!instance.embeddingDimension && processedDocuments[0]?.vector) {
        instance.embeddingDimension = processedDocuments[0].vector.length;
      }
      
      this.emit(VectorDBEvents.DOCUMENT_ADDED, {
        instanceId,
        data: { count: processedDocuments.length }
      });
    } else {
      throw new Error(result.error || "Failed to add documents");
    }
  }
  
  /**
   * Query a vector database
   * @param instanceId Instance ID
   * @param query Query text or vector
   * @param options Query options
   * @returns Promise resolving to query results
   */
  public async queryIndex(
    instanceId: string, 
    query: string | number[], 
    options: IQueryOptions = {}
  ): Promise<IQueryResult[]> {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Vector database instance ${instanceId} not found`);
    }
    
    // Update activity
    this.updateInstanceActivity(instanceId);
    
    // Get the embedding provider for this instance
    const embeddingProvider = instance.options.embeddingProvider;
    const embeddingProviderName = instance.options.embeddingProviderName;
    
    const providerName = embeddingProvider ? embeddingProvider.name : 'built-in';
    console.log(`Querying index ${instanceId} with embedding provider ${providerName}: ${query}`);
    
    // Process query
    let queryVector: number[];
    if (typeof query === 'string') {
      queryVector = await this.generateEmbedding(query, embeddingProvider, embeddingProviderName);
    } else {
      queryVector = query;
    }
    
    // Get the worker proxy
    const workerProxy = (instance as any).proxy as Comlink.Remote<IVectorDBWorkerAPI>;
    
    // Send query to worker using Comlink proxy
    const result = await workerProxy.queryIndex(queryVector, options);
    
    if (result.success) {
      this.emit(VectorDBEvents.QUERY_COMPLETED, {
        instanceId,
        data: { 
          resultCount: result.results!.length,
          query: typeof query === 'string' ? query : '[vector]'
        }
      });
      
      return result.results!;
    } else {
      throw new Error(result.error || "Query failed");
    }
  }
  
  /**
   * Remove documents from a vector database
   * @param instanceId Instance ID
   * @param documentIds Document IDs to remove
   * @returns Promise resolving when documents are removed
   */
  public async removeDocuments(instanceId: string, documentIds: string[]): Promise<void> {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Vector database instance ${instanceId} not found`);
    }
    
    // Update activity
    this.updateInstanceActivity(instanceId);
    
    // Get the worker proxy
    const workerProxy = (instance as any).proxy as Comlink.Remote<IVectorDBWorkerAPI>;
    
    // Send to worker using Comlink proxy
    const result = await workerProxy.removeDocuments(documentIds);
    
    if (result.success) {
      // Update document count
      instance.documentCount = Math.max(0, instance.documentCount - documentIds.length);
      
      this.emit(VectorDBEvents.DOCUMENT_REMOVED, {
        instanceId,
        data: { count: documentIds.length }
      });
    } else {
      throw new Error(result.error || "Failed to remove documents");
    }
  }
  
  /**
   * Destroy a vector database instance
   * @param instanceId Instance ID
   * @returns Promise resolving when instance is destroyed
   */
  public async destroyIndex(instanceId: string): Promise<void> {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Vector database instance ${instanceId} not found`);
    }
    
    // Clear any inactivity timer
    this.clearInactivityTimeout(instanceId);
    
    // Clean up activity tracking
    this.lastActivityTime.delete(instanceId);
    
    // Destroy the instance
    await instance.destroy();
    
    // Remove from map
    this.instances.delete(instanceId);
    
    // Emit destruction event
    this.emit(VectorDBEvents.INDEX_DESTROYED, {
      instanceId,
      data: { id: instanceId }
    });
  }
  
  /**
   * Destroy all instances
   * @param namespace Optional namespace to filter instances to destroy
   * @returns Promise resolving when all instances are destroyed
   */
  public async destroyAll(namespace?: string): Promise<void> {
    const ids = Array.from(this.instances.keys())
      .filter(id => {
        if (!namespace) return true;
        return id.startsWith(`${namespace}:`);
      });
    
    const destroyPromises = ids.map(id => this.destroyIndex(id));
    await Promise.all(destroyPromises);
  }
  
  /**
   * Get statistics about the vector database manager
   * @returns Manager statistics
   */
  public getStats(): {
    totalInstances: number;
    totalDocuments: number;
    embeddingModel: string;
    maxInstances: number;
    instancesByNamespace: Record<string, number>;
    activityMonitoring: {
      enabled: boolean;
      defaultTimeout: number;
      activeTimers: number;
      offloadDirectory: string;
    };
  } {
    let totalDocuments = 0;
    const instancesByNamespace: Record<string, number> = {};
    
    for (const [id, instance] of this.instances.entries()) {
      totalDocuments += instance.documentCount;
      
      const namespaceMatch = id.match(/^([^:]+):/);
      const namespace = namespaceMatch ? namespaceMatch[1] : 'default';
      
      instancesByNamespace[namespace] = (instancesByNamespace[namespace] || 0) + 1;
    }
    
    return {
      totalInstances: this.instances.size,
      totalDocuments,
      embeddingModel: this.embeddingModel,
      maxInstances: this.maxInstances,
      instancesByNamespace,
      activityMonitoring: {
        enabled: this.enableActivityMonitoring,
        defaultTimeout: this.defaultInactivityTimeout,
        activeTimers: this.inactivityTimers.size,
        offloadDirectory: this.offloadDirectory
      }
    };
  }

  /**
   * Get the last activity time for an instance
   * @param id Instance ID
   * @returns Last activity time in milliseconds since epoch, or undefined if not found
   */
  public getLastActivityTime(id: string): number | undefined {
    return this.lastActivityTime.get(id);
  }

  /**
   * Get the inactivity timeout for an instance
   * @param id Instance ID
   * @returns Inactivity timeout in milliseconds, or undefined if not set
   */
  public getInactivityTimeout(id: string): number | undefined {
    const instance = this.getInstance(id);
    if (!instance) return undefined;
    
    return instance.options.inactivityTimeout || this.defaultInactivityTimeout;
  }

  /**
   * Set or update the inactivity timeout for an instance
   * @param id Instance ID
   * @param timeout Timeout in milliseconds, or 0 to disable
   * @returns True if the timeout was set, false if the instance was not found
   */
  public setInactivityTimeout(id: string, timeout: number): boolean {
    const instance = this.getInstance(id);
    if (!instance) return false;
    
    // Update the timeout in the options
    instance.options.inactivityTimeout = timeout;
    
    // Clear any existing timer
    this.clearInactivityTimeout(id);
    
    // If timeout is greater than 0 and activity monitoring is enabled, set up a new timer
    const activityMonitoringEnabled = instance.options.enableActivityMonitoring !== false && this.enableActivityMonitoring;
    if (activityMonitoringEnabled && timeout > 0) {
      this.setupInactivityTimeout(id, timeout);
    }
    
    return true;
  }

  /**
   * Get time until auto-offload for an instance
   * @param id Instance ID
   * @returns Time in milliseconds until auto-offload, or undefined if no timeout is set
   */
  public getTimeUntilOffload(id: string): number | undefined {
    const instance = this.getInstance(id);
    if (!instance) return undefined;
    
    const timeout = instance.options.inactivityTimeout || this.defaultInactivityTimeout;
    const activityMonitoringEnabled = instance.options.enableActivityMonitoring !== false && this.enableActivityMonitoring;
    
    if (!activityMonitoringEnabled || !timeout || timeout <= 0) return undefined;
    
    const lastActivity = this.lastActivityTime.get(id);
    if (!lastActivity) return undefined;
    
    const elapsedTime = Date.now() - lastActivity;
    const remainingTime = timeout - elapsedTime;
    
    return Math.max(0, remainingTime);
  }

  /**
   * Manually offload an instance to disk
   * @param id Instance ID
   * @returns Promise resolving when instance is offloaded
   */
  public async manualOffload(id: string): Promise<void> {
    const instance = this.getInstance(id);
    if (!instance) {
      throw new Error(`Vector database instance ${id} not found`);
    }
    
    return this.offloadInstance(id);
  }

  /**
   * List all offloaded indices
   * @param namespace Optional namespace to filter by
   * @returns Promise resolving to array of offloaded index metadata
   */
  public async listOffloadedIndices(namespace?: string): Promise<Array<{
    id: string;
    created: Date;
    offloadedAt: Date;
    documentCount: number;
    embeddingDimension?: number;
    namespace?: string;
  }>> {
    try {
      const offloadedIndices: Array<{
        id: string;
        created: Date;
        offloadedAt: Date;
        documentCount: number;
        embeddingDimension?: number;
        namespace?: string;
      }> = [];
      
      // Read all metadata files in the offload directory
      for await (const dirEntry of Deno.readDir(this.offloadDirectory)) {
        if (dirEntry.isFile && dirEntry.name.endsWith('.metadata.json')) {
          try {
            const metadataPath = join(this.offloadDirectory, dirEntry.name);
            const metadataContent = await Deno.readTextFile(metadataPath);
            const metadata: IOffloadedIndexMetadata = JSON.parse(metadataContent);
            
            // Extract namespace from ID if present
            const namespaceMatch = metadata.id.match(/^([^:]+):/);
            const extractedNamespace = namespaceMatch ? namespaceMatch[1] : undefined;
            
            // Filter by namespace if specified
            if (namespace && extractedNamespace !== namespace) {
              continue;
            }
            
            offloadedIndices.push({
              id: metadata.id,
              created: new Date(metadata.created),
              offloadedAt: new Date(metadata.offloadedAt),
              documentCount: metadata.documentCount,
              embeddingDimension: metadata.embeddingDimension,
              namespace: extractedNamespace
            });
          } catch (error) {
            console.warn(`Failed to read metadata file ${dirEntry.name}:`, error);
          }
        }
      }
      
      // Sort by offload time (most recent first)
      offloadedIndices.sort((a, b) => b.offloadedAt.getTime() - a.offloadedAt.getTime());
      
      return offloadedIndices;
    } catch (error) {
      console.error("Error listing offloaded indices:", error);
      return [];
    }
  }

  /**
   * Delete an offloaded index from disk
   * @param id Instance ID
   * @returns Promise resolving when offloaded index is deleted
   */
  public async deleteOffloadedIndex(id: string): Promise<void> {
    try {
      const metadataPath = join(this.offloadDirectory, `${id}.metadata.json`);
      
      // Check if metadata file exists
      if (!(await exists(metadataPath))) {
        throw new Error(`Offloaded index ${id} not found`);
      }
      
      // Read metadata to determine format and files to delete
      const metadataContent = await Deno.readTextFile(metadataPath);
      const metadata: IOffloadedIndexMetadata = JSON.parse(metadataContent);
      
      // Delete metadata file
      await Deno.remove(metadataPath);
      
      // Delete documents file
      if (await exists(metadata.documentsFile)) {
        await Deno.remove(metadata.documentsFile);
      }
      
      // Delete vectors file if it exists (binary format)
      if (metadata.vectorsFile && await exists(metadata.vectorsFile)) {
        await Deno.remove(metadata.vectorsFile);
      }
      
      console.log(`🗑️ Deleted offloaded index ${id}`);
    } catch (error) {
      console.error(`Failed to delete offloaded index ${id}:`, error);
      throw new Error(`Failed to delete offloaded index: ${error}`);
    }
  }

  /**
   * Ping an instance to reset its activity timer and extend the deadline
   * @param id Instance ID
   * @returns True if the instance was pinged successfully, false if not found
   */
  public pingInstance(id: string): boolean {
    const instance = this.getInstance(id);
    if (!instance) {
      return false;
    }
    
    // Update instance activity (this will reset the inactivity timer)
    this.updateInstanceActivity(id);
    
    return true;
  }

  /**
   * Enable or disable activity monitoring globally
   * @param enabled Whether to enable activity monitoring
   */
  public setActivityMonitoring(enabled: boolean): void {
    this.enableActivityMonitoring = enabled;
    
    if (!enabled) {
      // Clear all existing timers
      for (const id of this.inactivityTimers.keys()) {
        this.clearInactivityTimeout(id);
      }
    } else {
      // Set up timers for instances that should have them
      for (const [id, instance] of this.instances.entries()) {
        const activityMonitoringEnabled = instance.options.enableActivityMonitoring !== false;
        const timeout = instance.options.inactivityTimeout || this.defaultInactivityTimeout;
        
        if (activityMonitoringEnabled && timeout && timeout > 0) {
          this.setupInactivityTimeout(id, timeout);
        }
      }
    }
  }

  // ===== EMBEDDING PROVIDER REGISTRY METHODS =====

  /**
   * Add an embedding provider to the registry
   * @param id Unique identifier for the provider
   * @param provider The embedding provider
   * @returns True if added successfully, false if ID already exists
   */
  public addEmbeddingProvider(id: string, provider: IEmbeddingProvider): boolean {
    if (this.providerRegistry.has(id)) {
      return false;
    }

    const entry: IProviderRegistryEntry = {
      id,
      provider,
      created: new Date()
    };

    this.providerRegistry.set(id, entry);

    this.emit(VectorDBEvents.PROVIDER_ADDED, {
      providerId: id,
      data: { 
        id, 
        type: provider.type,
        name: provider.name,
        dimension: provider.dimension,
        created: entry.created
      }
    });

    return true;
  }

  /**
   * Remove an embedding provider from the registry
   * @param id Provider ID to remove
   * @returns True if removed successfully, false if not found
   */
  public removeEmbeddingProvider(id: string): boolean {
    const entry = this.providerRegistry.get(id);
    if (!entry) {
      return false;
    }

    // Check if any instances are using this provider
    const instancesUsingProvider = Array.from(this.instances.values())
      .filter(instance => instance.options.embeddingProviderName === id);

    if (instancesUsingProvider.length > 0) {
      throw new Error(`Cannot remove provider ${id}: it is being used by ${instancesUsingProvider.length} instance(s)`);
    }

    this.providerRegistry.delete(id);

    this.emit(VectorDBEvents.PROVIDER_REMOVED, {
      providerId: id,
      data: { id, name: entry.provider.name }
    });

    return true;
  }

  /**
   * Update an embedding provider in the registry
   * @param id Provider ID to update
   * @param provider New provider configuration
   * @returns True if updated successfully, false if not found
   */
  public updateEmbeddingProvider(id: string, provider: IEmbeddingProvider): boolean {
    const entry = this.providerRegistry.get(id);
    if (!entry) {
      return false;
    }

    // Check if dimension changed and if any instances are using this provider
    if (entry.provider.dimension !== provider.dimension) {
      const instancesUsingProvider = Array.from(this.instances.values())
        .filter(instance => instance.options.embeddingProviderName === id);

      if (instancesUsingProvider.length > 0) {
        throw new Error(`Cannot update provider ${id}: dimension change would affect ${instancesUsingProvider.length} instance(s) with existing embeddings`);
      }
    }

    const oldProvider = entry.provider;
    entry.provider = provider;

    this.emit(VectorDBEvents.PROVIDER_UPDATED, {
      providerId: id,
      data: { 
        id, 
        oldProvider: {
          type: oldProvider.type,
          name: oldProvider.name,
          dimension: oldProvider.dimension
        },
        newProvider: {
          type: provider.type,
          name: provider.name,
          dimension: provider.dimension
        }
      }
    });

    return true;
  }

  /**
   * Get an embedding provider from the registry
   * @param id Provider ID
   * @returns Provider entry or undefined if not found
   */
  public getEmbeddingProvider(id: string): IProviderRegistryEntry | undefined {
    return this.providerRegistry.get(id);
  }

  /**
   * List all embedding providers in the registry
   * @returns Array of provider entries
   */
  public listEmbeddingProviders(): IProviderRegistryEntry[] {
    return Array.from(this.providerRegistry.values());
  }

  /**
   * Check if an embedding provider exists in the registry
   * @param id Provider ID
   * @returns True if provider exists
   */
  public hasEmbeddingProvider(id: string): boolean {
    return this.providerRegistry.has(id);
  }

  /**
   * Change the embedding provider for an existing index
   * @param instanceId Instance ID
   * @param providerName Name of the provider from registry
   * @returns Promise resolving when provider is changed
   */
  public async changeIndexEmbeddingProvider(instanceId: string, providerName: string): Promise<void> {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      throw new Error(`Vector database instance ${instanceId} not found`);
    }

    const providerEntry = this.providerRegistry.get(providerName);
    if (!providerEntry) {
      throw new Error(`Embedding provider ${providerName} not found in registry`);
    }

    // Check if dimensions match (if instance has existing embeddings)
    if (instance.embeddingDimension && instance.embeddingDimension !== providerEntry.provider.dimension) {
      throw new Error(`Cannot change provider: dimension mismatch. Instance has ${instance.embeddingDimension}D embeddings, provider has ${providerEntry.provider.dimension}D`);
    }

    // Update the instance options
    instance.options.embeddingProviderName = providerName;
    instance.options.embeddingProvider = providerEntry.provider;

    // Update last used time for the provider
    providerEntry.lastUsed = new Date();

    // Update activity
    this.updateInstanceActivity(instanceId);

    console.log(`✅ Changed embedding provider for instance ${instanceId} to ${providerName}`);
  }

  /**
   * Get embedding provider statistics
   * @returns Provider usage statistics
   */
  public getEmbeddingProviderStats(): {
    totalProviders: number;
    providersByType: Record<string, number>;
    providersInUse: number;
    providerUsage: Array<{
      id: string;
      name: string;
      type: string;
      dimension: number;
      instancesUsing: number;
      lastUsed?: Date;
      created: Date;
    }>;
  } {
    const providersByType: Record<string, number> = {};
    const providerUsage: Array<{
      id: string;
      name: string;
      type: string;
      dimension: number;
      instancesUsing: number;
      lastUsed?: Date;
      created: Date;
    }> = [];

    let providersInUse = 0;

    for (const [id, entry] of this.providerRegistry.entries()) {
      // Count by type
      providersByType[entry.provider.type] = (providersByType[entry.provider.type] || 0) + 1;

      // Count instances using this provider
      const instancesUsing = Array.from(this.instances.values())
        .filter(instance => instance.options.embeddingProviderName === id).length;

      if (instancesUsing > 0) {
        providersInUse++;
      }

      providerUsage.push({
        id,
        name: entry.provider.name,
        type: entry.provider.type,
        dimension: entry.provider.dimension,
        instancesUsing,
        lastUsed: entry.lastUsed,
        created: entry.created
      });
    }

    // Sort by usage (most used first), then by last used
    providerUsage.sort((a, b) => {
      if (a.instancesUsing !== b.instancesUsing) {
        return b.instancesUsing - a.instancesUsing;
      }
      if (a.lastUsed && b.lastUsed) {
        return b.lastUsed.getTime() - a.lastUsed.getTime();
      }
      if (a.lastUsed && !b.lastUsed) return -1;
      if (!a.lastUsed && b.lastUsed) return 1;
      return b.created.getTime() - a.created.getTime();
    });

    return {
      totalProviders: this.providerRegistry.size,
      providersByType,
      providersInUse,
      providerUsage
    };
  }
} 