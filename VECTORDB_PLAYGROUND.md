# Vector Database Playground

A beautiful web interface for exploring the Deno App Engine vector database capabilities.

## 🚀 Quick Start

1. **Start the server:**
   ```bash
   deno run -A scripts/server.ts
   ```

2. **Open the playground:**
   Navigate to [http://localhost:8000/vectordb](http://localhost:8000/vectordb)

## 🎯 Features

### 📊 Database Statistics
- View real-time stats about your vector database
- Monitor total indices, documents, and embedding model
- Track resource usage

### 🔧 Index Management
- **Create Indices**: Create new vector database indices with optional namespaces
- **List Indices**: View all existing indices with document counts and metadata
- **Delete Indices**: Remove indices with confirmation dialog

### 📝 Document Operations
- **Generate Random Documents**: Bulk add test documents with diverse topics
- **Add Custom Documents**: Add your own text documents with metadata
- **Automatic Embedding**: Text is automatically converted to vectors using mock embeddings

### 🔍 Semantic Search
- **Text-based Search**: Enter natural language queries
- **Configurable Results**: Set number of results (k) and similarity threshold
- **Rich Results**: View document text, similarity scores, and metadata
- **Real-time Search**: Instant results with beautiful formatting

## 🎨 Interface Highlights

- **Modern Design**: Clean, responsive interface with hover effects
- **Real-time Feedback**: Toast notifications for all operations
- **Loading States**: Spinners and disabled states during operations
- **Error Handling**: Graceful error messages and recovery
- **Mobile Friendly**: Responsive design works on all devices

## 🧪 Example Workflow

1. **Create an Index**
   - Enter an optional ID and namespace
   - Click "Create Index"

2. **Add Documents**
   - Select your index from the dropdown
   - Choose number of documents (1-100)
   - Click "Generate & Add Random Documents"

3. **Search Documents**
   - Select the same index
   - Enter a search query like "artificial intelligence"
   - Adjust results count and threshold
   - Click "Search"

4. **View Results**
   - See similarity scores and document content
   - Explore metadata for each result

## 🔧 API Endpoints

The playground uses these REST API endpoints:

- `GET /api/vectordb/stats` - Get database statistics
- `GET /api/vectordb/instances` - List all indices
- `POST /api/vectordb/indices` - Create new index
- `POST /api/vectordb/indices/{id}/documents` - Add documents
- `POST /api/vectordb/indices/{id}/query` - Search documents
- `DELETE /api/vectordb/indices/{id}` - Delete index
- `POST /api/vectordb/generate-documents` - Generate test documents

## 🎭 Mock Embeddings

The playground uses mock embeddings for demonstration purposes:
- **Fast**: No external API calls or heavy models
- **Deterministic**: Same text always produces same embedding
- **Diverse**: Generates varied vectors to avoid collisions
- **384 Dimensions**: Compatible with popular embedding models

## 🌟 Tips

- **Start Small**: Begin with 5-10 documents to see how it works
- **Try Different Queries**: Test various search terms to see semantic matching
- **Use Namespaces**: Organize indices by project or use case
- **Check Scores**: Higher scores indicate better matches
- **Experiment**: The playground is safe - create, search, and delete freely!

## 🔗 Integration

This playground demonstrates the vector database capabilities that can be integrated into:
- **RAG Applications**: Retrieval-Augmented Generation systems
- **Document Search**: Semantic search over document collections
- **Recommendation Systems**: Content-based recommendations
- **Knowledge Bases**: Intelligent information retrieval

## 🛠️ Development

The playground is built with:
- **Vanilla JavaScript**: No frameworks, just clean JS
- **Modern CSS**: CSS Grid, Flexbox, and custom properties
- **SVG Icons**: Scalable vector icons for all actions
- **Fetch API**: Modern HTTP requests to the backend

Enjoy exploring semantic search with the Vector Database Playground! 🎉 