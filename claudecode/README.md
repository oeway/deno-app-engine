# Claude Agent Manager - Hypha Service Integration

This guide demonstrates how to use the Claude Agent Manager through Hypha's distributed service protocol, enabling remote access to Claude Code agents with streaming capabilities and interactive permission handling.

## Overview

The Hypha service integration provides:
- 🌐 **Remote Access**: Connect to agents from anywhere via Hypha's WebSocket protocol
- 📡 **Streaming Execution**: Real-time streaming of agent responses
- 🔐 **Permission Management**: Interactive permission requests and responses
- 🎯 **Multi-Agent Support**: Manage multiple agents concurrently
- 🔄 **Session Continuity**: Maintain conversation context across messages

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Client App    │ <-----> │   Hypha Server   │ <-----> │  Agent Manager  │
│  (JavaScript/   │  WSS    │ (hypha.aicell.io)│  WSS    │     Service     │
│    Python)      │         │                  │         │   (Deno/Node)   │
└─────────────────┘         └──────────────────┘         └─────────────────┘
                                                                   │
                                                                   ▼
                                                          ┌─────────────────┐
                                                          │  Claude Agents  │
                                                          │   (Workers)     │
                                                          └─────────────────┘
```

## Quick Start

### 1. Start the Service

First, you need to start the Claude Agent Manager service which will register itself with the Hypha server:

```bash
# Basic startup
./start-hypha-service.sh

# Or with custom configuration
HYPHA_SERVER_URL=https://hypha.aicell.io \
SERVICE_ID=my-claude-service \
AGENT_BASE_DIRECTORY=./my-agents \
./start-hypha-service.sh

# Or run directly with Deno
deno run --allow-all src/hypha-service.ts
```

The service will output something like:
```
✅ Connected to Hypha server at https://hypha.aicell.io
📁 Workspace: ws-user-anonymouz-buttoned-bank-08100557
✅ Service registered with ID: ws-user-anonymouz-buttoned-bank-08100557/...
🔗 Full service path: ws-user-anonymouz-buttoned-bank-08100557/claude-agent-manager
🚀 Claude Agent Manager Service is running
```

**Important**: Note the workspace ID (e.g., `ws-user-anonymouz-buttoned-bank-08100557`). You'll need this to connect from clients.

### 2. Connect from Client

In a separate terminal, connect to the running service:

#### JavaScript/TypeScript Client

```javascript
import { hyphaWebsocketClient } from "hypha-rpc";

// Connect to Hypha
const server = await hyphaWebsocketClient.connectToServer({
  server_url: "https://hypha.aicell.io"
});

// Get the service
const service = await server.getService("claude-agent-manager");

// Create an agent (defaults to bypassPermissions mode)
const agent = await service.createAgent({
  name: "MyAgent",
  description: "Test agent"
  // permissionMode defaults to "bypassPermissions" for easier usage
});

// Execute with streaming
const generator = await service.executeStreaming({
  agentId: agent.id,
  prompt: "Create a hello world Python script"
});

// Process stream
for await (const update of generator) {
  if (update.type === "stream") {
    console.log("Response:", update.data);
  } else if (update.type === "permission") {
    // Handle permission request
    await service.respondToPermission({
      requestId: update.permissionRequest.id,
      action: "allow"
    });
  }
}
```

#### Python Client (Simple - Using display_message)

```python
import asyncio
from hypha_rpc import connect_to_server

async def main():
    # Connect to Hypha
    async with connect_to_server({"server_url": "https://hypha.aicell.io"}) as server:
        # Get the service
        service = await server.get_service("claude-agent-manager")
        
        # Create an agent (defaults to bypassPermissions mode)
        agent = await service.createAgent({
            "name": "PythonAgent",
            "description": "Demo agent for Python"
        })
        
        print(f"🤖 Created agent: {agent['name']} ({agent['id']})")
        print(f"📁 Working directory: {agent['workingDirectory']}")
        print("="*50)
        
        # Execute with streaming
        generator = await service.executeStreaming({
            "agentId": agent["id"],
            "prompt": "List files in current directory and create a hello.txt file"
        })
        
        async for update in generator:
            # Simply display the pre-formatted message
            if update.get("display_message"):
                print(update["display_message"])
                
            # Handle permission requests if any
            if update["type"] == "permission":
                await service.respondToPermission({
                    "requestId": update["permissionRequest"]["id"],
                    "action": "allow"
                })
        
        # Clean up
        print("="*50)
        print("🧹 Cleaning up...")
        await service.removeAgent(agent["id"])
        print("✅ Done!")

asyncio.run(main())
```

## Advanced Python Example (with custom formatting)

If you want more control over the output, you can still access the raw data:

```python
def format_message(update):
    """Format Claude messages with emojis for better readability"""
    if update["type"] == "stream":
        data = update.get("data", {})
        
        # Handle agent messages
        if data.get("type") == "agent":
            agent_data = data.get("data", {})
            msg_type = agent_data.get("type")
            
            if msg_type == "system":
                subtype = agent_data.get("subtype", "")
                if subtype == "init":
                    cwd = agent_data.get('cwd', 'N/A')
                    tools = agent_data.get('tools', [])
                    session_id = agent_data.get('session_id', 'N/A')
                    permission_mode = agent_data.get('permissionMode', 'unknown')
                    return f"⚙️  System initialized\n    📁 Working directory: {cwd}\n    🔧 Tools available: {len(tools)}\n    🆔 Session: {session_id[:8]}...\n    🔐 Permission mode: {permission_mode}"
                return f"ℹ️  System: {subtype}"
                
            elif msg_type == "assistant":
                message = agent_data.get("message", {})
                content = message.get("content", [])
                results = []
                for item in content:
                    if item.get("type") == "text":
                        text = item.get('text', '')
                        results.append(f"💬 Assistant: {text}")
                    elif item.get("type") == "tool_use":
                        tool_name = item.get("name", "unknown")
                        tool_input = item.get("input", {})
                        tool_icon = get_tool_icon(tool_name)
                        
                        # Format tool input based on the tool type
                        input_str = ""
                        if tool_name in ["Write", "Edit", "MultiEdit"]:
                            if "file_path" in tool_input:
                                input_str = f"\n    📄 File: {tool_input['file_path']}"
                            if "content" in tool_input and len(str(tool_input.get('content', ''))) < 200:
                                input_str += f"\n    📝 Content preview: {str(tool_input['content'])[:100]}..."
                        elif tool_name == "Bash":
                            if "command" in tool_input:
                                input_str = f"\n    $ {tool_input['command']}"
                        elif tool_name == "Read":
                            if "file_path" in tool_input:
                                input_str = f"\n    📖 Reading: {tool_input['file_path']}"
                        elif tool_name == "LS":
                            if "path" in tool_input:
                                input_str = f"\n    📂 Listing: {tool_input['path']}"
                        elif tool_input:
                            # Show first few key-value pairs
                            params = []
                            for k, v in list(tool_input.items())[:3]:
                                params.append(f"{k}={str(v)[:50]}")
                            if params:
                                input_str = f"\n    ⚙️  Parameters: {', '.join(params)}"
                        
                        results.append(f"{tool_icon} Using tool: {tool_name}{input_str}")
                return "\n".join(results) if results else None
                        
            elif msg_type == "result":
                subtype = agent_data.get("subtype", "")
                if subtype == "success":
                    result = agent_data.get("result", "Completed")
                    usage = agent_data.get("usage", {})
                    cost = agent_data.get("total_cost_usd", 0)
                    duration = agent_data.get("duration_ms", 0)
                    
                    input_tokens = usage.get('input_tokens', 0)
                    output_tokens = usage.get('output_tokens', 0)
                    
                    return f"✅ Success: {result}\n    📊 Tokens: {input_tokens} input, {output_tokens} output\n    💰 Cost: ${cost:.6f}\n    ⏱️  Duration: {duration}ms"
                elif subtype == "error":
                    error_msg = agent_data.get('error', 'Unknown error')
                    return f"❌ Error: {error_msg}"
                    
            elif msg_type == "user":
                # Tool results
                message = agent_data.get("message", {})
                content = message.get("content", [])
                results = []
                for item in content:
                    if item.get("type") == "tool_result":
                        tool_use_id = item.get("tool_use_id", "")
                        is_error = item.get("is_error", False)
                        result_content = item.get("content", "")
                        
                        # Truncate long results but show more than before
                        if len(result_content) > 500:
                            lines = result_content.split('\n')
                            if len(lines) > 15:
                                result_content = '\n'.join(lines[:15]) + f"\n    ... ({len(lines)-15} more lines)"
                            else:
                                result_content = result_content[:500] + "..."
                        
                        if is_error:
                            results.append(f"⚠️  Tool error:\n    {result_content}")
                        else:
                            # Show actual content for better understanding
                            if result_content.strip():
                                # Indent multiline content
                                indented = '\n    '.join(result_content.split('\n'))
                                results.append(f"📊 Tool result:\n    {indented}")
                            else:
                                results.append(f"📊 Tool completed successfully")
                                
                return "\n".join(results) if results else None
                        
    elif update["type"] == "permission":
        req = update.get("permissionRequest", {})
        tool = req.get("toolName", "unknown")
        patterns = req.get("patterns", [])
        desc = req.get("description", "")
        result = f"🔐 Permission requested\n    Tool: {tool}"
        if patterns:
            result += f"\n    Patterns: {', '.join(patterns)}"
        if desc:
            result += f"\n    Purpose: {desc}"
        return result
        
    elif update["type"] == "error":
        return f"❌ Error: {update.get('error', 'Unknown error')}"
        
    elif update["type"] == "done":
        return "✅ Execution completed successfully"
        
    elif update["type"] == "aborted":
        return "⚠️  Execution aborted"
        
    # Don't show raw unknown messages
    return None

def get_tool_icon(tool_name):
    """Get emoji icon for different tools"""
    icons = {
        'Task': '🎯',
        'Bash': '💻',
        'Read': '📖',
        'Write': '✍️',
        'Edit': '✏️',
        'MultiEdit': '📝',
        'Glob': '🔍',
        'Grep': '🔎',
        'LS': '📂',
        'WebFetch': '🌐',
        'WebSearch': '🔍',
        'TodoWrite': '📋',
        'NotebookEdit': '📓',
        'ExitPlanMode': '🚪',
        'BashOutput': '📊',
        'KillBash': '🛑'
    }
    
    if 'mcp__' in tool_name:
        return '🔌'
    return icons.get(tool_name, '🔧')

async def main():
    # Connect to Hypha
    async with connect_to_server({"server_url": "https://hypha.aicell.io"}) as server:
        # Get the service
        service = await server.get_service("claude-agent-manager")
        
        # Create an agent with bypassPermissions mode for easier demo
        agent = await service.createAgent({
            "name": "PythonAgent",
            "permissionMode": "bypassPermissions"  # No permission prompts
        })
        
        print(f"🤖 Created agent: {agent['name']} ({agent['id']})")
        print(f"📁 Working directory: {agent['workingDirectory']}")
        print("="*50)
        
        # Execute with streaming
        generator = await service.executeStreaming({
            "agentId": agent["id"],
            "prompt": "List files in current directory and create a hello.txt file"
        })
        
        async for update in generator:
            # Format and print the message
            formatted = format_message(update)
            if formatted:
                print(formatted)
                
            # Handle permission requests if any (won't happen with bypassPermissions)
            if update["type"] == "permission":
                await service.respondToPermission({
                    "requestId": update["permissionRequest"]["id"],
                    "action": "allow"
                })
        
        # Clean up
        print("="*50)
        print("🧹 Cleaning up...")
        await service.removeAgent(agent["id"])
        print("✅ Done!")

asyncio.run(main())
```

## Service API

### Agent Management

#### `createAgent(options?)`
Create a new agent with optional configuration.

```javascript
const agent = await service.createAgent({
  name: "DataAnalyst",
  description: "Agent for data analysis tasks",
  workingDirectory: "/custom/path",
  permissionMode: "default",  // Optional: defaults to "bypassPermissions" for easier usage
  allowedTools: ["write_file", "read_file", "execute"]
});
```

**Note**: The default `permissionMode` is set to `"bypassPermissions"` to avoid permission prompts during execution. You can override this by explicitly setting `permissionMode` to `"default"` or `"strict"` if you want interactive permission handling.

#### `getAgent(agentId)`
Get agent information by ID.

```javascript
const agentInfo = await service.getAgent("agent-123");
// Returns: { id, name, description, workingDirectory, permissionMode, allowedTools }
```

#### `getAllAgents()`
Get all active agents.

```javascript
const agents = await service.getAllAgents();
// Returns array of AgentInfo objects
```

#### `removeAgent(agentId, keepDirectory?)`
Remove an agent and optionally keep its working directory.

```javascript
const success = await service.removeAgent("agent-123", false);
```

### Execution

#### `execute(options)`
Execute a command without streaming (auto-denies permissions).

```javascript
const results = await service.execute({
  agentId: "agent-123",
  prompt: "What files are in the current directory?",
  sessionId: "session-456",  // Optional, for conversation continuity
  allowedTools: ["read_file"] // Optional, restrict tools
});
```

#### `executeStreaming(options)` ⭐
Execute with streaming and interactive permission handling.

```javascript
const generator = await service.executeStreaming({
  agentId: "agent-123",
  prompt: "Create a web server in Node.js",
  sessionId: "session-456"
});

for await (const update of generator) {
  switch (update.type) {
    case "stream":
      // Regular streaming data
      handleAgentResponse(update.data);
      break;
      
    case "permission":
      // Permission request from agent
      const decision = await promptUser(update.permissionRequest);
      await service.respondToPermission({
        requestId: update.permissionRequest.id,
        action: decision // "allow", "allow_permanent", or "deny"
      });
      break;
      
    case "error":
      console.error("Error:", update.error);
      break;
      
    case "done":
      console.log("Execution completed");
      break;
  }
}
```

### Permission Handling

#### `respondToPermission(response)`
Respond to a permission request from an agent.

```javascript
await service.respondToPermission({
  requestId: "perm-req-123",
  action: "allow",  // or "allow_permanent" or "deny"
  allowedTools: ["write_file", "read_file"] // Optional, for permanent allow
});
```

### Control & Information

#### `stopAgent(agentId)`
Stop an agent's current execution.

```javascript
const stopped = await service.stopAgent("agent-123");
```

#### `getInfo()`
Get manager information and statistics.

```javascript
const info = await service.getInfo();
// Returns: { baseDirectory, agentCount, agents, verified, defaultMcpServers }
```

## Stream Update Types

When using `executeStreaming()`, you'll receive different types of updates:

### Stream Update
Regular agent response data:
```javascript
{
  type: "stream",
  data: {
    type: "agent",
    data: { /* Claude SDK message */ }
  },
  timestamp: 1234567890
}
```

### Permission Update
Permission request requiring user response:
```javascript
{
  type: "permission",
  permissionRequest: {
    id: "perm-123",
    toolName: "write_file",
    patterns: ["./output.txt"],
    description: "Create output file"
  },
  timestamp: 1234567890
}
```

### Error Update
Error during execution:
```javascript
{
  type: "error",
  error: "Error message",
  timestamp: 1234567890
}
```

### Done/Aborted Updates
Execution completed or aborted:
```javascript
{
  type: "done", // or "aborted"
  timestamp: 1234567890
}
```

## Advanced Usage

### Session Continuity

Maintain conversation context across multiple messages:

```javascript
const sessionId = `session-${Date.now()}`;

// First message
await service.executeStreaming({
  agentId: agent.id,
  prompt: "Create a Python function to calculate fibonacci",
  sessionId: sessionId
});

// Follow-up message (maintains context)
await service.executeStreaming({
  agentId: agent.id,
  prompt: "Now add memoization to improve performance",
  sessionId: sessionId
});
```

### Tool Restrictions

Limit which tools an agent can use:

```javascript
await service.executeStreaming({
  agentId: agent.id,
  prompt: "Analyze this code",
  allowedTools: ["read_file", "grep"] // Only allow reading, no writing
});
```

### Custom Working Directories

Create agents with specific working directories:

```javascript
const agent = await service.createAgent({
  name: "ProjectAgent",
  workingDirectory: "/projects/my-project",
  permissionMode: "default"
});
```

## Environment Variables

Configure the service using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `HYPHA_SERVER_URL` | Hypha server URL | `https://hypha.aicell.io` |
| `HYPHA_WORKSPACE` | Specific workspace name | Auto-assigned |
| `HYPHA_TOKEN` | Authentication token | None |
| `SERVICE_ID` | Service registration ID | `claude-agent-manager` |
| `SERVICE_VISIBILITY` | Service visibility (`public`/`protected`) | `public` |
| `AGENT_BASE_DIRECTORY` | Base directory for agent workspaces | `./agent-workspaces` |
| `AGENT_MAX_COUNT` | Maximum concurrent agents | `10` |

## Example Applications

### 1. Code Assistant Bot

```javascript
// Create a code review assistant
const codeReviewer = await service.createAgent({
  name: "CodeReviewer",
  description: "Reviews code for best practices"
});

async function reviewCode(filePath) {
  const prompt = `Review the code in ${filePath} for:
    1. Code quality
    2. Potential bugs
    3. Performance issues
    4. Security concerns`;
    
  const generator = await service.executeStreaming({
    agentId: codeReviewer.id,
    prompt: prompt
  });
  
  // Process and display review
  for await (const update of generator) {
    // Handle updates...
  }
}
```

### 2. Interactive Tutorial System

```javascript
// Create an educational assistant
const tutor = await service.createAgent({
  name: "PythonTutor",
  description: "Interactive Python programming tutor"
});

async function startLesson(topic) {
  const sessionId = `lesson-${Date.now()}`;
  
  // Initial lesson
  await executeLesson(
    `Teach me about ${topic} with examples`,
    sessionId
  );
  
  // Interactive Q&A
  while (true) {
    const question = await getUserInput();
    if (question === 'exit') break;
    
    await executeLesson(question, sessionId);
  }
}
```

### 3. Multi-Agent Collaboration

```javascript
// Create specialized agents
const researcher = await service.createAgent({
  name: "Researcher",
  allowedTools: ["web_search", "read_file"]
});

const writer = await service.createAgent({
  name: "Writer",
  allowedTools: ["write_file", "edit_file"]
});

// Collaborate on a task
async function createArticle(topic) {
  // Research phase
  const research = await service.execute({
    agentId: researcher.id,
    prompt: `Research ${topic} and summarize key points`
  });
  
  // Writing phase
  await service.executeStreaming({
    agentId: writer.id,
    prompt: `Based on this research: ${research}
             Write a comprehensive article about ${topic}`
  });
}
```

## Running the Example Client

The repository includes a complete example client:

```bash
# Run the automated example
deno run --allow-net examples/hypha-service.ts

# Run in interactive mode
deno run --allow-net examples/hypha-service.ts --interactive
```

## Security Considerations

1. **Permission Modes**: 
   - `default`: Balanced security with functionality
   - `strict`: Maximum isolation (limited functionality)
   - `bypassPermissions`: Full access (use with caution)

2. **Tool Restrictions**: Always specify `allowedTools` when possible to limit agent capabilities

3. **Working Directory Isolation**: Each agent operates in its own directory by default

4. **Network Access**: Control network permissions through Deno's permission system

## Troubleshooting

### Service Not Found
```
Error: Service 'claude-agent-manager' not found
```
**Solution**: Ensure the service is running and check the workspace name.

### Permission Denied
```
Error: Permission denied for tool 'write_file'
```
**Solution**: Respond to permission requests or adjust `permissionMode`.

### Connection Failed
```
Error: Failed to connect to Hypha server
```
**Solution**: Check network connection and `HYPHA_SERVER_URL`.

## Best Practices

1. **Always handle permissions**: Implement proper permission handling for production use
2. **Use session IDs**: Maintain conversation continuity for better context
3. **Clean up agents**: Remove agents when done to free resources
4. **Monitor usage**: Track token usage through result messages
5. **Error handling**: Implement comprehensive error handling for all stream types
6. **Tool restrictions**: Limit tools to minimum required for the task

## Support

For issues or questions:
- 📖 [Claude Code Documentation](https://github.com/anthropics/claude-code)
- 🔗 [Hypha Documentation](https://hypha.ai)
- 💬 [GitHub Issues](https://github.com/your-repo/issues)