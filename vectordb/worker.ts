// Vector Database Worker
// This worker handles vector database operations using Voy

// Import fake-indexeddb polyfill for IndexedDB API
import "npm:fake-indexeddb/auto";

// Import the Voy search engine
import { Voy } from "./voy_search.js";

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

// Worker state
let voyIndex: any = null;
let documents: Map<string, IDocument> = new Map();
let isInitialized = false;
let instanceId = "";

/**
 * Initialize the worker with Voy index
 */
function initialize(options: any): void {
  try {
    instanceId = options.id;
    
    // Create empty Voy index
    const resource = { embeddings: [] };
    voyIndex = new Voy(resource);
    
    isInitialized = true;
    
    // Send ready signal
    self.postMessage({
      type: "WORKER_READY",
      instanceId
    });
    
  } catch (error) {
    console.error("Error initializing vector database worker:", error);
    self.postMessage({
      type: "WORKER_ERROR",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Add documents to the index
 */
function addDocuments(docs: IDocument[]): void {
  try {
    if (!isInitialized || !voyIndex) {
      throw new Error("Worker not initialized");
    }
    
    // Store documents in our map
    for (const doc of docs) {
      documents.set(doc.id, doc);
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
    voyIndex.add(resource);
    
    self.postMessage({
      type: "ADD_DOCUMENTS_RESULT",
      success: true,
      count: docs.length
    });
    
  } catch (error) {
    console.error("Error adding documents:", error);
    self.postMessage({
      type: "ADD_DOCUMENTS_RESULT",
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Query the index
 */
function queryIndex(vector: number[], options: IQueryOptions): void {
  try {
    if (!isInitialized || !voyIndex) {
      throw new Error("Worker not initialized");
    }
    
    const k = options.k || 10;
    const threshold = options.threshold || 0;
    const includeMetadata = options.includeMetadata !== false;
    
    // Perform search
    const queryVector = new Float32Array(vector);
    const searchResults = voyIndex.search(queryVector, k);
    
    // Convert results to our format
    const results: IQueryResult[] = searchResults.neighbors
      .map((result: any, index: number) => {
        const doc = documents.get(result.id);
        
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
    
    self.postMessage({
      type: "QUERY_RESULT",
      success: true,
      results
    });
    
  } catch (error) {
    console.error("Error querying index:", error);
    self.postMessage({
      type: "QUERY_RESULT",
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Remove documents from the index
 */
function removeDocuments(documentIds: string[]): void {
  try {
    if (!isInitialized || !voyIndex) {
      throw new Error("Worker not initialized");
    }
    
    // Remove from our document map
    for (const id of documentIds) {
      documents.delete(id);
    }
    
    // For Voy, we need to rebuild the index without the removed documents
    // Convert remaining documents to Voy format
    const remainingDocs = Array.from(documents.values());
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
    voyIndex = new Voy(resource);
    
    self.postMessage({
      type: "REMOVE_DOCUMENTS_RESULT",
      success: true,
      removedCount: documentIds.length
    });
    
  } catch (error) {
    console.error("Error removing documents:", error);
    self.postMessage({
      type: "REMOVE_DOCUMENTS_RESULT",
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Get index statistics
 */
function getStats(): void {
  try {
    if (!isInitialized || !voyIndex) {
      throw new Error("Worker not initialized");
    }
    
    const stats = {
      documentCount: documents.size,
      indexSize: voyIndex.size(),
      instanceId
    };
    
    self.postMessage({
      type: "STATS_RESULT",
      success: true,
      stats
    });
    
  } catch (error) {
    console.error("Error getting stats:", error);
    self.postMessage({
      type: "STATS_RESULT",
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// Message handler
self.addEventListener('message', (event: MessageEvent) => {
  const { type, ...data } = event.data;
  
  try {
    switch (type) {
      case "INITIALIZE":
        initialize(data.options);
        break;
        
      case "ADD_DOCUMENTS":
        addDocuments(data.documents);
        break;
        
      case "QUERY":
        queryIndex(data.vector, data.options);
        break;
        
      case "REMOVE_DOCUMENTS":
        removeDocuments(data.documentIds);
        break;
        
      case "GET_STATS":
        getStats();
        break;
        
      default:
        console.warn(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error(`Error handling message type ${type}:`, error);
    self.postMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Send initial ready signal
console.log("Vector database worker loaded"); 