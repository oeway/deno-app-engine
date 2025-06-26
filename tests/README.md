# Hypha Service Test Documentation

This directory contains comprehensive tests for the Deno App Engine Hypha Service that validate all major functionality through realistic workflows.

## Test Architecture

### Single Comprehensive Test: `hypha-service-comprehensive.test.ts`

This file contains a **complete end-to-end test** that covers realistic workflows for all service components:

#### **Phase 1: Service Initialization and Health Check**
- Service startup and connection validation
- System status monitoring (uptime, memory, CPU usage)
- Initial resource state verification

#### **Phase 2: Kernel Workflows - Data Science Pipeline**
- Python kernel creation for data analysis
- **Realistic Scenarios:**
  - Data analysis with pandas and numpy (weather data statistics)
  - Machine learning pipeline with scikit-learn (linear regression)
  - Streaming execution for real-time computational output
  - Error handling and kernel recovery testing
- Kernel lifecycle management and cleanup

#### **Phase 3: Vector Database Workflows - Knowledge Management**
- Vector index creation with embedding providers
- **Realistic Document Collections:**
  - Research papers (AI/ML, databases, programming)
  - Tutorial content (Python, TypeScript)
  - Scientific data (climate research)
- **Semantic Search Workflows:**
  - AI/ML content queries
  - Programming language searches
  - Document management operations (add, update, query)

#### **Phase 4: AI Agent Workflows - Intelligent Assistance**
- **Research Assistant Agent:**
  - Basic conversational AI testing
  - Code generation and execution requests
  - Knowledge question answering
- **Data Science Specialist Agent:**
  - Statistical analysis tasks
  - Machine learning model discussions
  - Multi-turn conversation with context retention
- **Agent Features:**
  - Kernel attachment and code execution
  - Startup script configuration
  - Conversation history management

#### **Phase 5: Integration Scenarios - Combined Workflows**
- Agents performing complex statistical analysis via kernels
- Cross-agent knowledge sharing scenarios
- Multi-component workflow validation

#### **Phase 6: Performance and Resource Management**
- System resource monitoring during operations
- Vector database statistics and optimization
- Agent performance metrics

#### **Phase 7: Cleanup and Verification**
- Systematic resource cleanup (agents → vector indices → kernels)
- Resource leak detection
- Final system state validation

## Running Tests

### Quick Command
```bash
# Run the comprehensive workflow test
deno task test-hypha
```

### Manual Command
```bash
# Full test with detailed output
deno test --allow-all tests/hypha-service-comprehensive.test.ts
```

### Additional Tools
```bash
# Manual client for testing live services
deno task test-hypha-client
```

## Test Data and Scenarios

### Sample Data Sets
- **Research Documents**: ML papers, database research, programming tutorials
- **Code Snippets**: Data analysis workflows, machine learning pipelines
- **Realistic Queries**: Semantic searches for specific topics and technologies

### Workflow Patterns
1. **Data Science Pipeline**: Create kernel → Load data → Analyze → Model → Predict
2. **Knowledge Management**: Create index → Add documents → Search → Update → Query
3. **AI Assistant**: Create agent → Configure → Converse → Execute code → Analyze results
4. **Integration**: Agent uses kernel for analysis + searches vector DB for context

## Key Features Tested

### Kernel Management
- ✅ Python worker kernel creation and configuration
- ✅ Code execution with complex libraries (pandas, numpy, scikit-learn)
- ✅ Streaming execution with real-time output
- ✅ Error handling and recovery mechanisms
- ✅ Concurrent execution capabilities

### Vector Database Operations  
- ✅ Index creation with different embedding providers
- ✅ Document management (add, update, query, delete)
- ✅ Semantic search with various query types
- ✅ Metadata filtering and result ranking
- ✅ Provider management and statistics

### AI Agent Capabilities
- ✅ Agent creation with different specializations
- ✅ Conversational AI with context retention
- ✅ Code generation and execution via attached kernels
- ✅ Multi-turn conversations with complex reasoning
- ✅ Agent lifecycle and resource management

### System Integration
- ✅ Cross-component interactions (agent + kernel + vector DB)
- ✅ Resource monitoring and performance tracking
- ✅ Proper cleanup and resource leak prevention
- ✅ Error propagation and recovery across components

## Benefits of the Comprehensive Approach

### Realistic Testing
- Tests actual user workflows rather than isolated functions
- Validates end-to-end scenarios developers will encounter
- Ensures components work together seamlessly

### Maintainability  
- Single test file eliminates duplication
- Consistent test patterns and assertions
- Clear phase-based organization

### Coverage
- All major service functionality tested
- Edge cases and error conditions covered
- Performance and resource usage validated

### Reliability
- Direct import approach avoids authentication issues
- No external process dependencies
- Predictable test execution and cleanup

## Environment Configuration

The test uses these environment variables when available:
- `HYPHA_SERVER_URL`: Target server (default: https://hypha.aicell.io)
- `EMBEDDING_MODEL`: Default embedding model (default: mock-model) 
- `AGENT_MODEL_NAME`: AI model for agents (default: llama3.2:1b for CI, qwen2.5-coder:7b for production)
- `KERNEL_POOL_*`: Kernel pooling configuration
- `VECTORDB_*`: Vector database settings

## Troubleshooting

### Common Issues
1. **Network connectivity**: Ensure access to https://hypha.aicell.io
2. **Resource limits**: Monitor memory usage during execution
3. **Timing issues**: Tests include appropriate delays for async operations
4. **Model availability**: AI agent tests require functional model endpoints

### Debug Tips
1. Review test phase output for specific failure points
2. Check system resource usage during test execution
3. Verify cleanup completion at end of test
4. Monitor console output for service-level errors

This comprehensive test provides confidence that the entire Hypha Service ecosystem works correctly for real-world use cases. 