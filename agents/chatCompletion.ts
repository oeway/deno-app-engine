import OpenAI from 'openai';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content?: string;
  tool_call_id?: string;
  tool_calls?: {
    type: string;
    name: string;
    function: any;
    id: string;
  }[];
}

export interface ModelSettings {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
}


function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Utility functions for adaptive streaming
interface StreamingMetrics {
  totalChars: number;
  startTime: number;
  lastMeasurement: number;
  recentRate: number; // chars per second
}

function createStreamingMetrics(): StreamingMetrics {
  const now = Date.now();
  return {
    totalChars: 0,
    startTime: now,
    lastMeasurement: now,
    recentRate: 0
  };
}

function updateStreamingRate(metrics: StreamingMetrics, newChars: number): number {
  const now = Date.now();
  const timeDelta = now - metrics.lastMeasurement;
  
  metrics.totalChars += newChars;
  
  // Update recent rate (using a 2-second sliding window for responsiveness)
  if (timeDelta > 0) {
    const instantRate = (newChars / timeDelta) * 1000; // chars per second
    // Exponential moving average for smoothing
    metrics.recentRate = metrics.recentRate === 0 ? instantRate : 
                         (metrics.recentRate * 0.7 + instantRate * 0.3);
  }
  
  metrics.lastMeasurement = now;
  return metrics.recentRate;
}

interface AdaptiveParams {
  yieldIntervalMs: number;
  maxBatchSize: number;
}

function getAdaptiveParams(streamingRate: number): AdaptiveParams {
  // Adaptive thresholds based on streaming rate (chars/second)
  if (streamingRate > 1000) {
    // Fast streaming - prioritize responsiveness
    return {
      yieldIntervalMs: 50,
      maxBatchSize: 150
    };
  } else if (streamingRate > 200) {
    // Medium streaming - balanced approach
    return {
      yieldIntervalMs: 100,
      maxBatchSize: 300
    };
  } else if (streamingRate > 50) {
    // Slow streaming - more batching for efficiency
    return {
      yieldIntervalMs: 200,
      maxBatchSize: 500
    };
  } else {
    // Very slow streaming - maximum batching
    return {
      yieldIntervalMs: 300,
      maxBatchSize: 800
    };
  }
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  onExecuteCode?: (completionId: string, scriptContent: string, language?: string) => Promise<string>;
  onMessage?: (completionId: string, message: string, commitIds?: string[]) => void;
  onStreaming?: (completionId: string, message: string) => void;
  maxSteps?: number; // Maximum number of tool call steps before stopping
  baseURL?: string; // Base URL for the API
  apiKey?: string; // API key for authentication
  stream?: boolean;
  abortController?: AbortController; // Add abortController to options
  reset?: boolean; // Reset memory and start fresh
  // Service manager for checking completion results
  serviceManager?: any; // AgentServiceManager instance
  agentId?: string; // Agent ID for service checking
  agentKernelType?: string; // Agent's kernel type for syntax conversion decisions
  // Streaming optimization options (these are initial values, system will adapt based on streaming speed)
  initialYieldIntervalMs?: number; // Initial interval for yielding chunks (default: 100ms, will adapt)
  initialMaxBatchSize?: number; // Initial max characters per batch (default: 300, will adapt)
  enableAdaptiveStreaming?: boolean; // Enable adaptive streaming based on connection speed (default: true)
}

// Update DefaultModelSettings to use the ModelSettings interface
export const DefaultModelSettings: ModelSettings = {
    baseURL: 'http://localhost:11434/v1/',
    apiKey: 'ollama',
    model: 'qwen2.5-coder:7b',
    temperature: 0.7,
  };

// Legacy tag extraction removed - all communication now goes through HyphaCore storage

// Helper function to extract script content and language
interface ScriptInfo {
  content: string;
  language: string;
}

// Convert markdown code blocks to script tags
function convertMarkdownToScript(text: string): string {
  // If the text already contains script tags, don't convert anything
  // This prevents converting markdown blocks that might be inside script content
  if (/<script\b[^>]*>/i.test(text)) {
    return text;
  }
  
  // Only convert top-level markdown code blocks (not nested inside other content)
  const markdownRegex = /```(\w+)\s*([\s\S]*?)```/gi;
  
  return text.replace(markdownRegex, (match, language, code) => {
    const trimmedCode = code.trim();
    const supportedLanguages = ['python', 'javascript', 'typescript', 'js', 'ts'];
    
    // Normalize language names
    let normalizedLang = language.toLowerCase();
    if (normalizedLang === 'js') normalizedLang = 'javascript';
    if (normalizedLang === 'ts') normalizedLang = 'typescript';
    
    // Only convert supported languages
    if (supportedLanguages.includes(normalizedLang) || supportedLanguages.includes(language.toLowerCase())) {
      return `<script lang="${normalizedLang}">\n${trimmedCode}\n</script>`;
    }
    
    return match; // Return original if not a supported language
  });
}

function extractScript(script: string): ScriptInfo | null {
  // First, try to convert any markdown code blocks to script tags
  const convertedScript = convertMarkdownToScript(script);
  
  // Match various script tag formats:
  // 1. <script lang="language">
  const scriptRegexLang = /<script\s+lang=["'](\w+)["'][^>]*>([\s\S]*?)<\/script>/i;
  // 2. <script type="text/language">
  const scriptRegexType = /<script\s+type=["']text\/(\w+)["'][^>]*>([\s\S]*?)<\/script>/i;
  // 3. Plain <script> (default to javascript)
  const scriptRegexPlain = /<script[^>]*>([\s\S]*?)<\/script>/i;
  
  let match = convertedScript.match(scriptRegexLang);
  if (match) {
    return {
      content: match[2].trim(),
      language: match[1].toLowerCase()
    };
  }
  
  match = convertedScript.match(scriptRegexType);
  if (match) {
    return {
      content: match[2].trim(),
      language: match[1].toLowerCase()
    };
  }
  
  match = convertedScript.match(scriptRegexPlain);
  if (match) {
    return {
      content: match[1].trim(),
      language: 'javascript' // Default to javascript for plain script tags
    };
  }
  
  return null;
}

// Helper function to get the script tag format that was used
function getScriptTagFormat(script: string): string {
  // Check for script lang format (with or without id attribute)
  const formatMatch = script.match(/<script\s+lang=["'](\w+)["'][^>]*>/i);
  if (formatMatch) {
    return `script lang="${formatMatch[1]}"`;
  }
  
  return 'script lang="python"'; // Default fallback
}

// Helper function to validate that assistant messages follow script format
function validateAssistantMessageFormat(content: string, isCodeAgent: boolean): boolean {
  if (!isCodeAgent) {
    // Non-code agents can have any format
    return true;
  }
  
  // For code agents, assistant messages should contain script tags
  const hasScript = extractScript(content) !== null;
  if (!hasScript) {
    console.warn('WARNING: Code agent assistant message lacks script format:', content.slice(0, 100) + '...');
    return false;
  }
  
  return true;
}

// Helper function to ensure assistant message is properly formatted before adding to history
function addAssistantMessageToHistory(messages: ChatMessage[], content: string, completionId: string, isCodeAgent: boolean): void {
  if (isCodeAgent) {
    // For code agents, ensure the message contains script tags
    const scriptInfo = extractScript(content);
    if (scriptInfo) {
      const scriptTagFormat = getScriptTagFormat(content);
      const formattedContent = content.includes(`id="${completionId}"`) 
        ? content 
        : `<${scriptTagFormat} id="${completionId}">${scriptInfo.content}</${scriptTagFormat.split(' ')[0]}>`;
      
      messages.push({
        role: 'assistant',
        content: formattedContent
      });
      console.log('DEBUG: Added properly formatted assistant message to history');
    } else {
      console.warn('WARNING: Attempting to add non-script assistant message for code agent - skipping');
    }
  } else {
    // Non-code agents can add any content
    messages.push({
      role: 'assistant',
      content
    });
    console.log('DEBUG: Added assistant message to history (non-code agent)');
  }
}



export async function* chatCompletion({
  messages,
  systemPrompt,
  model = 'qwen2.5-coder:7b',
  temperature = 0.7,
  onExecuteCode,
  onMessage,
  onStreaming,
  maxSteps = 10,
  baseURL = 'http://localhost:11434/v1/',
  apiKey = 'ollama',
  stream = true,
  abortController, // Add abortController parameter
  serviceManager, // Service manager for checking completion results
  agentId, // Agent ID for service checking
  initialYieldIntervalMs = 100, // Initial 100ms yield interval
  initialMaxBatchSize = 300, // Initial 300 characters max batch size
  enableAdaptiveStreaming = true, // Enable adaptive streaming by default
  agentKernelType, // Agent's kernel type for language-specific examples
}: ChatCompletionOptions): AsyncGenerator<{
  type: 'text' | 'text_chunk' | 'function_call' | 'function_call_output' | 'new_completion' | 'error' | 'guidance';
  content?: string;
  name?: string;
  arguments?: any;
  call_id?: string;
  completion_id?: string;
  error?: Error;
}, void, unknown> {
  try {
    // Create a new AbortController if one wasn't provided
    const controller = abortController || new AbortController();
    const { signal } = controller;

    // Ensure baseURL ends with "/"
    const normalizedBaseURL = baseURL.endsWith('/') ? baseURL : baseURL + '/';

    const openai = new OpenAI({
      baseURL: normalizedBaseURL,
      apiKey,
      dangerouslyAllowBrowser: true
    });

      let loopCount = 0;
  let guidanceProvided = false;

  while (loopCount < maxSteps) {
      // Check if abort signal was triggered
      if (signal.aborted) {
        console.log('Chat completion aborted by user');
        return;
      }

      // Add example exchanges only if code execution is available
      let exampleExchanges: ChatMessage[] = [];
      
      if (onExecuteCode) {
        // Generate language-specific examples based on agent's kernel type
        const kernelType = agentKernelType?.toLowerCase();
        
        if (kernelType === 'typescript') {
          exampleExchanges = [
            {
              role: 'user',
              content: 'Calculate 2 + 3 and show me the result'
            },
            {
              role: 'assistant', 
              content: '<script lang="typescript">\nconst result = 2 + 3;\nawait returnToUser(`The calculation result is **${result}**`);\n</script>'
            },
            {
              role: 'user',
              content: '<observation>Code executed. Output:\n```\n(no output)\n```\nContinue with the next step.</observation>'
            },
            {
              role: 'user',
              content: 'Write a simple function to greet someone'
            },
            {
              role: 'assistant',
              content: '<script lang="typescript">\nfunction greet(name: string): string {\n    return `Hello, ${name}!`;\n}\n\n// Test and return the result\nconst greeting = greet("World");\nawait returnToUser(`I created a greeting function. Here\'s a test: ${greeting}`);\n</script>'
            },
            {
              role: 'user', 
              content: '<observation>Code executed. Output:\n```\n(no output)\n```\nContinue with the next step.</observation>'
            }
          ];
        } else if (kernelType === 'javascript') {
          exampleExchanges = [
            {
              role: 'user',
              content: 'Calculate 2 + 3 and show me the result'
            },
            {
              role: 'assistant', 
              content: '<script lang="javascript">\nconst result = 2 + 3;\nawait returnToUser(`The calculation result is **${result}**`);\n</script>'
            },
            {
              role: 'user',
              content: '<observation>Code executed. Output:\n```\n(no output)\n```\nContinue with the next step.</observation>'
            },
            {
              role: 'user',
              content: 'Write a simple function to greet someone'
            },
            {
              role: 'assistant',
              content: '<script lang="javascript">\nfunction greet(name) {\n    return `Hello, ${name}!`;\n}\n\n// Test and return the result\nconst greeting = greet("World");\nawait returnToUser(`I created a greeting function. Here\'s a test: ${greeting}`);\n</script>'
            },
            {
              role: 'user', 
              content: '<observation>Code executed. Output:\n```\n(no output)\n```\nContinue with the next step.</observation>'
            }
          ];
        } else {
          // Default to Python examples for python kernel or unspecified
          exampleExchanges = [
            {
              role: 'user',
              content: 'Calculate 2 + 3 and show me the result'
            },
            {
              role: 'assistant', 
              content: '<script lang="python">\nresult = 2 + 3\nawait returnToUser(f"The calculation result is **{result}**")\n</script>'
            },
            {
              role: 'user',
              content: '<observation>Code executed. Output:\n```\n(no output)\n```\nContinue with the next step.</observation>'
            },
            {
              role: 'user',
              content: 'Write a simple function to greet someone'
            },
            {
              role: 'assistant',
              content: '<script lang="python">\ndef greet(name):\n    return f"Hello, {name}!"\n\n# Test and return the result\ngreeting = greet("World")\nawait returnToUser(f"I created a greeting function. Here\'s a test: {greeting}")\n</script>'
            },
            {
              role: 'user', 
              content: '<observation>Code executed. Output:\n```\n(no output)\n```\nContinue with the next step.</observation>'
            }
          ];
        }
      }

      const baseMessages = systemPrompt
        ? [{ role: 'system' as const, content: systemPrompt }]
        : [];
      
      const fullMessages = [...baseMessages, ...exampleExchanges, ...messages];
      const completionId = generateId();
      
      // Enhanced debugging for system prompt inclusion
      if (systemPrompt) {
        console.log('DEBUG: System prompt included:', systemPrompt.slice(0, 100) + (systemPrompt.length > 100 ? '...' : ''));
      } else {
        console.log('DEBUG: No system prompt provided');
      }
      // console.log('DEBUG: new completion', completionId, 'total messages:', fullMessages.length, 'roles:', fullMessages.map(m => m.role));
      yield {
        type: 'new_completion',
        completion_id: completionId,
      };

      let accumulatedResponse = '';

      // Create completion (streaming or non-streaming based on stream parameter)
      try {
        const completionRequest = {
          model,
          messages: fullMessages as OpenAI.Chat.ChatCompletionMessageParam[],
          temperature,
          stream: stream,
        };

        const requestOptions = {
          signal // Pass the abort signal as part of the request options
        };

        if (stream) {
          // Handle streaming response
          const completionStream = await openai.chat.completions.create(
            completionRequest,
            requestOptions
          ) as any; // Type as any since we know it's a stream when stream=true

          // Process the stream with adaptive queue-based batching
          try {
            let chunkQueue = '';
            let streamEnded = false;
            let streamingMetrics = createStreamingMetrics();
            let currentParams = { 
              yieldIntervalMs: initialYieldIntervalMs, 
              maxBatchSize: initialMaxBatchSize 
            };
            
            // Create an adaptive batched yielder
            const createAdaptiveBatchedYielder = async function* () {
              while (!streamEnded || chunkQueue.length > 0) {
                // Wait for the current yield interval unless we hit max batch size
                const startTime = Date.now();
                const waitTime = currentParams.yieldIntervalMs;
                
                while (Date.now() - startTime < waitTime && 
                       chunkQueue.length < currentParams.maxBatchSize && 
                       !streamEnded) {
                  await new Promise(resolve => setTimeout(resolve, 10)); // Small sleep to prevent busy waiting
                }
                
                // Flush if we have content
                if (chunkQueue.length > 0) {
                  const batchContent = chunkQueue;
                  chunkQueue = '';
                  
                  // console.log(`DEBUG Adaptive batch (${batchContent.length} chars, rate: ${streamingMetrics.recentRate.toFixed(0)} chars/sec, interval: ${currentParams.yieldIntervalMs}ms): ${batchContent.slice(0, 50)}${batchContent.length > 50 ? '...' : ''}`);
                  
                  if (onStreaming) {
                    onStreaming(completionId, batchContent);
                  }
                  
                  yield {
                    type: 'text_chunk' as const,
                    content: batchContent
                  };
                }
              }
            };

            // Start the adaptive batched yielder
            const batchedYielder = createAdaptiveBatchedYielder();

            // Process chunks from the stream and the batched yielder concurrently
            const streamProcessor = async () => {
              try {
                for await (const chunk of completionStream) {
                  // Check if abort signal was triggered during streaming
                  if (signal.aborted) {
                    console.log('Chat completion stream aborted by user');
                    streamEnded = true;
                    return;
                  }

                  // More robust content extraction with better error handling
                  let content = '';
                  if (chunk && chunk.choices && Array.isArray(chunk.choices) && chunk.choices.length > 0) {
                    const choice = chunk.choices[0];
                    if (choice && choice.delta) {
                      content = choice.delta.content || '';
                    } else if (choice && choice.message) {
                      // Handle non-streaming format that might come through
                      content = choice.message.content || '';
                    }
                  } else {
                    console.warn('Unexpected chunk format:', chunk);
                    continue; // Skip this chunk if it doesn't have the expected structure
                  }

                  if (content) {
                    accumulatedResponse += content;
                    chunkQueue += content;
                    
                    // Update streaming metrics and adapt parameters if enabled
                    if (enableAdaptiveStreaming) {
                      const currentRate = updateStreamingRate(streamingMetrics, content.length);
                      const newParams = getAdaptiveParams(currentRate);
                      
                      // Only update if parameters changed significantly to avoid thrashing
                      if (Math.abs(newParams.yieldIntervalMs - currentParams.yieldIntervalMs) > 20 ||
                          Math.abs(newParams.maxBatchSize - currentParams.maxBatchSize) > 50) {
                        currentParams = newParams;
                      }
                    }
                  }
                }
              } finally {
                streamEnded = true;
              }
            };

            // Start processing the stream
            const streamPromise = streamProcessor();

            // Yield from the batched yielder
            for await (const batch of batchedYielder) {
              if (signal.aborted) {
                console.log('Chat completion batched yielding aborted by user');
                break;
              }
              yield batch;
            }

            // Wait for stream processing to complete
            await streamPromise;
            // Complete the debug line with a newline after streaming finishes
            if (accumulatedResponse) {
              console.log(); // Add newline to complete the progressive debug line
            }
            
            // Yield the final accumulated text for compatibility
            if (accumulatedResponse) {
              yield {
                type: 'text',
                content: accumulatedResponse
              };
            }
          } catch (error) {
            // Check if error is due to abortion
            if (signal.aborted) {
              console.log('Stream processing aborted by user');
              return;
            }

            console.error('Error processing streaming response:', error);
            yield {
              type: 'error',
              content: `Error processing response: ${error instanceof Error ? error.message : 'Unknown error'}`,
              error: error instanceof Error ? error : new Error('Unknown error processing response')
            };
            return; // Exit generator on stream processing error
          }
        } else {
          // Handle non-streaming response
          const completion = await openai.chat.completions.create(
            { ...completionRequest, stream: false }, // Explicitly set stream: false
            requestOptions
          ) as OpenAI.Chat.ChatCompletion; // Type as ChatCompletion since stream=false

          // Check if abort signal was triggered
          if (signal.aborted) {
            console.log('Chat completion aborted by user');
            return;
          }

          accumulatedResponse = completion.choices[0]?.message?.content || '';
          
          if(onStreaming && accumulatedResponse){
            onStreaming(completionId, accumulatedResponse);
          }
          yield {
            type: 'text',
            content: accumulatedResponse
          };
        }

        // Log the assistant response for debugging
        console.log('DEBUG: assistant response', completionId, 'content:', accumulatedResponse.slice(0, 200) + (accumulatedResponse.length > 200 ? '...' : ''));

      } catch (error) {
        console.error('Error connecting to LLM API:', error);
        let errorMessage = 'Failed to connect to the language model API';

        // Check for specific OpenAI API errors
        if (error instanceof Error) {
          // Handle common API errors
          if (error.message.includes('404')) {
            errorMessage = `Invalid model endpoint: ${normalizedBaseURL} or model: ${model}`;
          } else if (error.message.includes('401') || error.message.includes('403')) {
            errorMessage = `Authentication error: Invalid API key`;
          } else if (error.message.includes('429')) {
            errorMessage = `Rate limit exceeded. Please try again later.`;
          } else if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
            errorMessage = `Connection timeout. The model endpoint (${normalizedBaseURL}) may be unavailable.`;
          } else {
            errorMessage = `API error: ${error.message}`;
          }
        }

        yield {
          type: 'error',
          content: errorMessage,
          error: error instanceof Error ? error : new Error(errorMessage)
        };
        return; // Exit generator on API error
      }

              // Parse and validate the accumulated response
      try {
        // Check if abort signal was triggered after streaming
        if (signal.aborted) {
          console.log('Chat completion parsing aborted by user');
          return;
        }

          // Skip empty responses
          if (accumulatedResponse.trim().length === 0) {
            console.log('DEBUG: Skipping empty response');
            break;
          }

          // Always try to extract script first
          const scriptInfo = extractScript(accumulatedResponse);
          
          if (!scriptInfo) {
            // No script found - handle based on agent type
            console.log('DEBUG: No script found');
            
            // If this is a non-code agent (no onExecuteCode), accept first response as final
            if (!onExecuteCode) {
              console.log('DEBUG: Non-code agent, treating as final response');
              yield {
                type: 'text',
                content: accumulatedResponse
              };
              break;
            }
            
            // For code agents, silently ignore the malformed response and inject guidance
            console.log('DEBUG: Code agent without script - injecting guidance and retrying');
            
            // Don't add the malformed assistant response to messages history
            // Instead, modify the last user message by appending guidance as a note
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && lastMessage.role === 'user') {
              // Add guidance as a note to the user's message
              const originalContent = lastMessage.content || '';
              const guidanceNote = '\n\n**Note: Please respond with code in script tags, for example: <script lang="python">your_code_here</script>**';
              
              // Check if guidance was already added to avoid duplication
              if (!originalContent.includes('**Note: Please respond with code in script tags')) {
                lastMessage.content = originalContent + guidanceNote;
                console.log('DEBUG: Added guidance note to last user message');
              }
            }
            
            // Continue the loop to regenerate (don't break, don't increment loop count)
            continue;
          }

          // Script found - execute it
          const { content: scriptContent, language: scriptLanguage } = scriptInfo;
          
          if (!onExecuteCode) {
            // No code execution handler available - break out of loop with the script content
            console.warn('Script execution detected but no onExecuteCode handler available');
            
            // Since no execution is possible, return the script content as the final response
            yield {
              type: 'text',
              content: accumulatedResponse
            };
            
            // Exit the loop
            break;
          } else {
            // Check if abort signal was triggered before tool execution
            if (signal.aborted) {
              console.log('Chat completion tool execution aborted by user');
              return;
            }

            yield {
              type: 'function_call',
              name: 'runCode',
              arguments: {
                code: scriptContent,
                language: scriptLanguage
              },
              call_id: completionId
            };

            // Always add assistant message in proper script format to maintain consistency
            addAssistantMessageToHistory(messages, accumulatedResponse, completionId, !!onExecuteCode);

            if(onStreaming){
              onStreaming(completionId, `Executing code...`);
            }

            // Execute the code
            try {
              const result = await onExecuteCode(
                completionId,
                scriptContent,
                scriptLanguage
              );

              // NOW check for returnToUser after code execution
              if (serviceManager) {
                const serviceCalls = serviceManager.getServiceCalls(completionId, agentId);
                
                if (serviceCalls && serviceCalls.returnToUser) {
                  console.log(`📤 returnToUser detected after code execution, stopping conversation`);
                  const returnData = serviceCalls.returnToUser.data;
                  
                  // Clear service calls for this completion
                  serviceManager.clearServiceCalls(completionId, agentId);
                  
                  if (onMessage) {
                    onMessage(completionId, returnData.content, returnData.commitIds || []);
                  }
                  
                  yield {
                    type: 'text',
                    content: returnData.content
                  };
                  
                  // Exit the loop since we have a final response
                  return;
                }
              }

              // Add execution result to messages and continue (follow exact format from examples)
              messages.push({
                role: 'user',
                content: `<observation>Code executed. Output:\n\`\`\`\n${result}\n\`\`\`\nContinue with the next step.</observation>`
              });

            } catch (error) {
              console.error('Error executing code:', error);
              const errorMessage = `Error executing code: ${error instanceof Error ? error.message : 'Unknown error'}`;

              yield {
                type: 'error',
                content: errorMessage,
                error: error instanceof Error ? error : new Error(errorMessage)
              };

              // Add error message to messages and continue (follow exact format from examples)
              messages.push({
                role: 'user',
                content: `<observation>Error executing code: ${error instanceof Error ? error.message : 'Unknown error'}\nPlease fix the error and try again.</observation>`
              });
          }
        }
        
        // Only count this as a step if we processed meaningful content (script execution)
        const hasExecutableContent = extractScript(accumulatedResponse);
        if (hasExecutableContent) {
          loopCount++;
        }
        
        // add a reminder message if we are approaching the max steps
        if(loopCount >= maxSteps - 2){
          // Check if HyphaCore services are available for context-aware reminder
          const hasHyphaServices = serviceManager?.hasServiceForCompletion?.(agentId) || false;
          const reminderMessage = hasHyphaServices 
            ? `You are approaching the maximum number of steps (${maxSteps}). Please conclude the session with await returnToUser() function call within executed code, otherwise the session will be aborted.`
            : `You are approaching the maximum number of steps (${maxSteps}). Please conclude the session by printing your final answer within executed code, otherwise the session will be aborted.`;
            
          messages.push({
            role: 'user',
            content: reminderMessage
          });
        }

        // Check if we've hit the loop limit
        if (loopCount >= maxSteps) {
          console.warn(`Chat completion reached maximum loop limit of ${maxSteps}`);
          if(onMessage){
            onMessage(completionId, `Reached maximum number of tool calls (${maxSteps}). Some actions may not have completed. I'm returning control to you now. Please try breaking your request into smaller steps or provide additional guidance.`, []);
          }
          yield {
            type: 'text',
            content: `Reached maximum number of tool calls (${maxSteps}). Some actions may not have completed. I'm returning control to you now. Please try breaking your request into smaller steps or provide additional guidance.`
          };
          break;
        }
      } catch (error: unknown) {
        console.error('Error parsing or processing response:', error);
        let errorMessage = 'Failed to process the model response';

        if (error instanceof Error) {
          errorMessage = `Error: ${error.message}`;
        }

        yield {
          type: 'error',
          content: errorMessage,
          error: error instanceof Error ? error : new Error(errorMessage)
        };

        // Try to add a message to recover if possible
        messages.push({
          role: 'user',
          content: `<observation>Error in processing: ${errorMessage}. Please try again with a simpler approach.</observation>`
        });
      }
    }
  } catch (err) {
    console.error('Error in structured chat completion:', err);
    const errorMessage = `Chat completion error: ${err instanceof Error ? err.message : 'Unknown error'}`;

    yield {
      type: 'error',
      content: errorMessage,
      error: err instanceof Error ? err : new Error(errorMessage)
    };
  }
}

