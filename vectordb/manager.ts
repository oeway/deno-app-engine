// Vector Database Manager for Deno App Engine
// This file manages vector database instances in web workers

import * as Comlink from "comlink";
import { EventEmitter } from 'node:events';
import { pipeline } from "@huggingface/transformers";

// Vector database events
export enum VectorDBEvents {
  INDEX_CREATED = "index_created",
  INDEX_DESTROYED = "index_destroyed",
  DOCUMENT_ADDED = "document_added",
  DOCUMENT_REMOVED = "document_removed",
  QUERY_COMPLETED = "query_completed",
  ERROR = "error"
}

// Interface for vector database instance
export interface IVectorDBInstance {
  id: string;
  worker: Worker;
  created: Date;
  options: IVectorDBOptions;
  documentCount: number;
  embeddingDimension?: number;
  destroy(): Promise<void>;
}

// Interface for vector database options
export interface IVectorDBOptions {
  id?: string;
  namespace?: string;
  embeddingModel?: string;
  maxDocuments?: number;
  persistData?: boolean;
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
  maxInstances?: number;
  allowedNamespaces?: string[];
}

/**
 * VectorDBManager class manages multiple vector database instances 
 * running in web workers
 */
export class VectorDBManager extends EventEmitter {
  private instances: Map<string, IVectorDBInstance> = new Map();
  private embeddingPipeline: any = null;
  private embeddingModel: string;
  private maxInstances: number;
  private allowedNamespaces?: string[];
  
  constructor(options: IVectorDBManagerOptions = {}) {
    super();
    super.setMaxListeners(100);
    
    this.embeddingModel = options.defaultEmbeddingModel || "mixedbread-ai/mxbai-embed-xsmall-v1";
    this.maxInstances = options.maxInstances || 50;
    this.allowedNamespaces = options.allowedNamespaces;
    
    // Initialize embedding pipeline
    this.initializeEmbeddingPipeline();
  }
  
  /**
   * Initialize the embedding pipeline
   * @private
   */
  private async initializeEmbeddingPipeline(): Promise<void> {
    // Skip initialization for mock models (used in testing)
    if (this.embeddingModel === "mock-model") {
      console.log("🤖 Using mock embedding model for testing");
      return;
    }
    
    try {
      console.log(`🤖 Initializing embedding pipeline with model: ${this.embeddingModel}`);
      
      this.embeddingPipeline = await pipeline(
        "feature-extraction",
        this.embeddingModel,
        { 
          device: "cpu",
          dtype: "q8"
        }
      );
      
      console.log("✅ Embedding pipeline initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize embedding pipeline:", error);
      throw new Error(`Failed to initialize embedding pipeline: ${error}`);
    }
  }
  
  /**
   * Generate embeddings for text
   * @param text Text to embed
   * @returns Promise resolving to embedding vector
   * @private
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // For mock model, use a simple deterministic embedding
    if (this.embeddingModel === "mock-model") {
      return this.createMockEmbedding(text);
    }
    
    if (!this.embeddingPipeline) {
      await this.initializeEmbeddingPipeline();
    }
    
    try {
      const result = await this.embeddingPipeline(text, { 
        pooling: "mean", 
        normalize: true 
      });
      
      return Array.from(result.data);
    } catch (error) {
      console.error(`Failed to generate embedding for text: "${text.substring(0, 100)}..."`);
      throw error;
    }
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
    
    // Check namespace permissions
    if (this.allowedNamespaces && namespace && !this.allowedNamespaces.includes(namespace)) {
      throw new Error(`Namespace ${namespace} is not allowed`);
    }
    
    // Apply namespace prefix if provided
    const id = namespace ? `${namespace}:${baseId}` : baseId;
    
    // Check if instance with this ID already exists
    if (this.instances.has(id)) {
      throw new Error(`Vector database with ID ${id} already exists`);
    }
    
    // Create worker
    const worker = new Worker(
      new URL("./worker.ts", import.meta.url).href,
      { type: "module" }
    );
    
    // Create a promise that resolves when the worker is initialized
    const initPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Worker initialization timeout"));
      }, 30000);
      
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "WORKER_READY") {
          worker.removeEventListener('message', handler);
          clearTimeout(timeout);
          resolve();
        } else if (event.data?.type === "WORKER_ERROR") {
          worker.removeEventListener('message', handler);
          clearTimeout(timeout);
          reject(new Error(event.data.error));
        }
      };
      
      worker.addEventListener('message', handler);
    });
    
    // Initialize the worker
    worker.postMessage({
      type: "INITIALIZE",
      options: {
        id,
        embeddingModel: this.embeddingModel,
        ...options
      }
    });
    
    // Wait for worker initialization
    await initPromise;
    
    // Create the instance
    const instance: IVectorDBInstance = {
      id,
      worker,
      created: new Date(),
      options,
      documentCount: 0,
      destroy: async () => {
        worker.terminate();
      }
    };
    
    // Store the instance
    this.instances.set(id, instance);
    
    // Set up event forwarding
    this.setupEventForwarding(instance);
    
    // Emit creation event
    this.emit(VectorDBEvents.INDEX_CREATED, {
      instanceId: id,
      data: { id, created: instance.created }
    });
    
    return id;
  }
  
  /**
   * Setup event forwarding from worker to manager
   * @param instance Vector database instance
   * @private
   */
  private setupEventForwarding(instance: IVectorDBInstance): void {
    const eventHandler = (event: MessageEvent) => {
      if (event.data && event.data.type && event.data.type.startsWith('EVENT_')) {
        const eventType = event.data.type.replace('EVENT_', '').toLowerCase();
        this.emit(eventType, {
          instanceId: instance.id,
          data: event.data.data
        });
      }
    };
    
    instance.worker.addEventListener('message', eventHandler);
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
    
    // Process documents and generate embeddings for text-only documents
    const processedDocuments = await Promise.all(
      documents.map(async (doc) => {
        if (doc.vector) {
          // Document already has vector
          return doc;
        } else if (doc.text) {
          // Generate embedding for text
          const vector = await this.generateEmbedding(doc.text);
          return { ...doc, vector };
        } else {
          throw new Error(`Document ${doc.id} must have either text or vector`);
        }
      })
    );
    
    // Send to worker
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Add documents timeout"));
      }, 60000);
      
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "ADD_DOCUMENTS_RESULT") {
          instance.worker.removeEventListener('message', handler);
          clearTimeout(timeout);
          
          if (event.data.success) {
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
            
            resolve();
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      
      instance.worker.addEventListener('message', handler);
      instance.worker.postMessage({
        type: "ADD_DOCUMENTS",
        documents: processedDocuments
      });
    });
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
    
    // Process query
    let queryVector: number[];
    if (typeof query === 'string') {
      queryVector = await this.generateEmbedding(query);
    } else {
      queryVector = query;
    }
    
    // Send query to worker
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Query timeout"));
      }, 30000);
      
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "QUERY_RESULT") {
          instance.worker.removeEventListener('message', handler);
          clearTimeout(timeout);
          
          if (event.data.success) {
            this.emit(VectorDBEvents.QUERY_COMPLETED, {
              instanceId,
              data: { 
                resultCount: event.data.results.length,
                query: typeof query === 'string' ? query : '[vector]'
              }
            });
            
            resolve(event.data.results);
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      
      instance.worker.addEventListener('message', handler);
      instance.worker.postMessage({
        type: "QUERY",
        vector: queryVector,
        options
      });
    });
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
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Remove documents timeout"));
      }, 30000);
      
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "REMOVE_DOCUMENTS_RESULT") {
          instance.worker.removeEventListener('message', handler);
          clearTimeout(timeout);
          
          if (event.data.success) {
            // Update document count
            instance.documentCount = Math.max(0, instance.documentCount - documentIds.length);
            
            this.emit(VectorDBEvents.DOCUMENT_REMOVED, {
              instanceId,
              data: { count: documentIds.length }
            });
            
            resolve();
          } else {
            reject(new Error(event.data.error));
          }
        }
      };
      
      instance.worker.addEventListener('message', handler);
      instance.worker.postMessage({
        type: "REMOVE_DOCUMENTS",
        documentIds
      });
    });
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
      instancesByNamespace
    };
  }
} 