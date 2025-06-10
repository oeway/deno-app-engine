// Vector Database Worker
// This worker handles vector database operations using Voy

// Import fake-indexeddb polyfill for IndexedDB API
import "npm:fake-indexeddb/auto";

// Import the Voy search engine
import { Voy } from "./voy_search.js";

// @ts-ignore Import Comlink from Deno
import * as Comlink from "https://deno.land/x/comlink@4.4.1/mod.ts";

// Interface for document
interface IDocument {
  id: string;
  text?: string;
  vector?: number[];
  metadata?: Record<string, any>;
}

// Interface for query options
interface IQueryOptions {
  k?: number;
  threshold?: number;
  includeMetadata?: boolean;
}

// Interface for query result
interface IQueryResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
  text?: string;
}

// Interface for vector database worker API
export interface IVectorDBWorkerAPI {
  initialize(options: any): Promise<void>;
  addDocuments(docs: IDocument[]): Promise<{ success: boolean; count?: number; error?: string }>;
  queryIndex(vector: number[], options: IQueryOptions): Promise<{ success: boolean; results?: IQueryResult[]; error?: string }>;
  removeDocuments(documentIds: string[]): Promise<{ success: boolean; removedCount?: number; error?: string }>;
  getStats(): Promise<{ success: boolean; stats?: any; error?: string }>;
  getDocuments(): Promise<{ success: boolean; documents?: IDocument[]; error?: string }>;
}

// Vector Database Worker Implementation
class VectorDBWorker implements IVectorDBWorkerAPI {
  private voyIndex: any = null;
  private documents: Map<string, IDocument> = new Map();
  private isInitialized = false;
  private instanceId = "";

  async initialize(options: any): Promise<void> {
    try {
      this.instanceId = options.id;
      
      // Create empty Voy index
      const resource = { embeddings: [] };
      this.voyIndex = new Voy(resource);
      
      this.isInitialized = true;
      
      console.log(`[VDB_WORKER] Initialized vector database instance: ${this.instanceId}`);
    } catch (error) {
      console.error("Error initializing vector database worker:", error);
      throw error;
    }
  }

  async addDocuments(docs: IDocument[]): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      if (!this.isInitialized || !this.voyIndex) {
        throw new Error("Worker not initialized");
      }
      
      // Store documents in our map
      for (const doc of docs) {
        this.documents.set(doc.id, doc);
      }
      
      // Convert documents to Voy format
      const voyEmbeddings = docs.map(doc => ({
        id: doc.id,
        title: doc.text || doc.id,
        url: `/doc/${doc.id}`,
        embeddings: doc.vector!
      }));
      
      // Add to Voy index
      const resource = { embeddings: voyEmbeddings };
      this.voyIndex.add(resource);
      
      return {
        success: true,
        count: docs.length
      };
      
    } catch (error) {
      console.error("Error adding documents:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async queryIndex(vector: number[], options: IQueryOptions): Promise<{ success: boolean; results?: IQueryResult[]; error?: string }> {
    try {
      if (!this.isInitialized || !this.voyIndex) {
        throw new Error("Worker not initialized");
      }
      
      const k = options.k || 10;
      const threshold = options.threshold || 0;
      const includeMetadata = options.includeMetadata !== false;
      
      // Perform search
      const queryVector = new Float32Array(vector);
      const searchResults = this.voyIndex.search(queryVector, k);
      
      // Convert results to our format
      const results: IQueryResult[] = searchResults.neighbors
        .map((result: any, index: number) => {
          const doc = this.documents.get(result.id);
          
          // Voy doesn't provide scores, so we'll use a simple ranking score
          // Higher rank (lower index) = higher score
          const score = 1.0 - (index / searchResults.neighbors.length);
          
          return {
            id: result.id,
            score: score,
            metadata: includeMetadata ? doc?.metadata : undefined,
            text: doc?.text
          };
        })
        .filter((result: IQueryResult) => result.score >= threshold);
      
      return {
        success: true,
        results
      };
      
    } catch (error) {
      console.error("Error querying index:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async removeDocuments(documentIds: string[]): Promise<{ success: boolean; removedCount?: number; error?: string }> {
    try {
      if (!this.isInitialized || !this.voyIndex) {
        throw new Error("Worker not initialized");
      }
      
      // Remove from our document map
      for (const id of documentIds) {
        this.documents.delete(id);
      }
      
      // For Voy, we need to rebuild the index without the removed documents
      // Convert remaining documents to Voy format
      const remainingDocs = Array.from(this.documents.values());
      const voyEmbeddings = remainingDocs
        .filter(doc => doc.vector) // Only include docs with vectors
        .map(doc => ({
          id: doc.id,
          title: doc.text || doc.id,
          url: `/doc/${doc.id}`,
          embeddings: doc.vector!
        }));
      
      // Rebuild the index
      const resource = { embeddings: voyEmbeddings };
      this.voyIndex = new Voy(resource);
      
      return {
        success: true,
        removedCount: documentIds.length
      };
      
    } catch (error) {
      console.error("Error removing documents:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getStats(): Promise<{ success: boolean; stats?: any; error?: string }> {
    try {
      if (!this.isInitialized || !this.voyIndex) {
        throw new Error("Worker not initialized");
      }
      
      const stats = {
        documentCount: this.documents.size,
        indexSize: this.voyIndex.size(),
        instanceId: this.instanceId
      };
      
      return {
        success: true,
        stats
      };
      
    } catch (error) {
      console.error("Error getting stats:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getDocuments(): Promise<{ success: boolean; documents?: IDocument[]; error?: string }> {
    try {
      if (!this.isInitialized) {
        throw new Error("Worker not initialized");
      }
      
      // Convert documents map to array
      const documentsArray = Array.from(this.documents.values());
      
      return {
        success: true,
        documents: documentsArray
      };
      
    } catch (error) {
      console.error("Error getting documents:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Create worker instance
const worker = new VectorDBWorker();

// Global error handler
self.addEventListener("error", (event) => {
  console.error("[VDB_WORKER] Global error caught:", event.error);
  event.preventDefault();
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("[VDB_WORKER] Unhandled promise rejection:", event.reason);
  event.preventDefault();
});

// Expose worker via Comlink
Comlink.expose(worker);

// Send initial ready signal
console.log("Vector database worker loaded"); 