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
  onExecuteCode?: (completionId: string, scriptContent: string) => Promise<string>;
  onMessage?: (completionId: string, message: string, commitIds?: string[]) => void;
  onStreaming?: (completionId: string, message: string) => void;
  maxSteps?: number; // Maximum number of tool call steps before stopping
  baseURL?: string; // Base URL for the API
  apiKey?: string; // API key for authentication
  stream?: boolean;
  abortController?: AbortController; // Add abortController to options
  reset?: boolean; // Reset memory and start fresh
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

// Helper function to extract final response from script
interface ReturnToUserResult {
  content: string;
  properties: Record<string, string>;
}

function extractReturnToUser(script: string): ReturnToUserResult | null {
  // Match <returnToUser> with optional attributes, followed by content, then closing tag
  const match = script.match(/<returnToUser(?:\s+([^>]*))?>([\s\S]*?)<\/returnToUser>/);
  if (!match) return null;

  // Extract properties from attributes if they exist
  const properties: Record<string, string> = {};
  const [, attrs, content] = match;

  if (attrs) {
    // Match all key="value" or key='value' pairs
    const propRegex = /(\w+)=["']([^"']*)["']/g;
    let propMatch;
    while ((propMatch = propRegex.exec(attrs)) !== null) {
      const [, key, value] = propMatch;
      properties[key] = value;
    }
  }

  return {
    content: content.trim(),
    properties
  };
}

// Helper function to extract thoughts from script
function extractThoughts(script: string): string | null {
  const match = script.match(/<thoughts>([\s\S]*?)<\/thoughts>/);
  return match ? match[1].trim() : null;
}

// Helper function to extract script content
function extractScript(script: string): string | null {
  // Try different script tag types in order
  const tagTypes = ['py-script', 't-script', 'js-script'];
  
  for (const tagType of tagTypes) {
    const regex = new RegExp(`<${tagType}(?:\\s+[^>]*)?>[\\s\\S]*?<\\/${tagType}>`, 'i');
    const match = script.match(regex);
    if (match) {
      // Extract content between tags
      const contentRegex = new RegExp(`<${tagType}(?:\\s+[^>]*)?>(([\\s\\S]*?))<\\/${tagType}>`, 'i');
      const contentMatch = script.match(contentRegex);
      return contentMatch ? contentMatch[1].trim() : null;
    }
  }
  
  return null;
}

// Helper function to get the script tag type that was used
function getScriptTagType(script: string): string {
  const tagTypes = ['py-script', 't-script', 'js-script'];
  
  for (const tagType of tagTypes) {
    const regex = new RegExp(`<${tagType}(?:\\s+[^>]*)?>[\\s\\S]*?<\\/${tagType}>`, 'i');
    if (script.match(regex)) {
      return tagType;
    }
  }
  
  return 'py-script'; // Default fallback
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
  initialYieldIntervalMs = 100, // Initial 100ms yield interval
  initialMaxBatchSize = 300, // Initial 300 characters max batch size
  enableAdaptiveStreaming = true, // Enable adaptive streaming by default
}: ChatCompletionOptions): AsyncGenerator<{
  type: 'text' | 'text_chunk' | 'function_call' | 'function_call_output' | 'new_completion' | 'error';
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
  let guidanceCount = 0; // Track guidance attempts to prevent infinite guidance loops
  let lastResponseContent = ''; // Track last response to detect infinite loops

  while (loopCount < maxSteps) {
      // Check if abort signal was triggered
      if (signal.aborted) {
        console.log('Chat completion aborted by user');
        return;
      }

      const fullMessages = systemPrompt
        ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
        : messages;
      const completionId = generateId();
      
      // Enhanced debugging for system prompt inclusion
      if (systemPrompt) {
        console.log('DEBUG: System prompt included:', systemPrompt.slice(0, 100) + (systemPrompt.length > 100 ? '...' : ''));
      } else {
        console.log('DEBUG: No system prompt provided');
      }
      console.log('DEBUG: new completion', completionId, 'total messages:', fullMessages.length, 'roles:', fullMessages.map(m => m.role));

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

        // Log the assistant response for debugging (similar to how user queries are logged)
        console.log('DEBUG: assistant response', completionId, 'content:', accumulatedResponse.slice(0, 200) + (accumulatedResponse.length > 200 ? '...' : ''));

        // Check for infinite loop - if we get the same response twice in a row, break out
        // Also break if we get empty responses repeatedly
        if (accumulatedResponse.trim().length === 0 && lastResponseContent.trim().length === 0) {
          console.warn('DEBUG: Detected infinite loop - repeated empty responses');
          
          // Force a returnToUser to break the loop
          if(onMessage){
            onMessage(completionId, `Detected repeated empty responses. Ending conversation to prevent infinite loop.`, []);
          }
          yield {
            type: 'text',
            content: `Detected repeated empty responses. Ending conversation to prevent infinite loop.`
          };
          break;
        } else if (accumulatedResponse.trim() === lastResponseContent.trim() && accumulatedResponse.trim().length > 0) {
          console.warn('DEBUG: Detected potential infinite loop - same response repeated');
          console.warn('DEBUG: Response content:', accumulatedResponse.trim().slice(0, 100));
          
          // Force a returnToUser to break the loop
          if(onMessage){
            onMessage(completionId, `Detected repeated response pattern. Ending conversation to prevent infinite loop.`, []);
          }
          yield {
            type: 'text',
            content: `Detected repeated response pattern. Ending conversation to prevent infinite loop.`
          };
          break;
        }
        lastResponseContent = accumulatedResponse;

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

      // Parse and validate the accumulated JSON
      try {
        // Check if abort signal was triggered after streaming
        if (signal.aborted) {
          console.log('Chat completion parsing aborted by user');
          return;
        }

        // Extract thoughts for logging
        const thoughts = extractThoughts(accumulatedResponse);
        if (thoughts) {
          console.log('Thoughts:', thoughts);
        }

        // Check if this is a final response - if so, we should stop the loop and return control to the user
        const returnToUser = extractReturnToUser(accumulatedResponse);
        if (returnToUser) {
          if(onMessage){
              // Extract commit IDs from properties and pass them as an array
              const commitIds = returnToUser.properties.commit ?
                returnToUser.properties.commit.split(',').map(id => id.trim()) :
                [];

              onMessage(completionId, returnToUser.content, commitIds);
          }
          yield {
            type: 'text',
            content: returnToUser.content
          };
          // Exit the loop since we have a final response that concludes this round of conversation
          return;
        }

        // Handle script execution
        const scriptContent = extractScript(accumulatedResponse);
        if (scriptContent) {
          if (!onExecuteCode) {
            // No code execution handler available - skip execution and inform the model
            console.warn('Script execution detected but no onExecuteCode handler available');
            
            // Get the script tag type that was actually used
            const scriptTagType = getScriptTagType(accumulatedResponse);
            
            // Add the tool call to messages with XML format
            messages.push({
              role: 'assistant',
              content: `<thoughts>${thoughts}</thoughts>\n<${scriptTagType} id="${completionId}">${scriptContent}</${scriptTagType}>`
            });

            // Add an error message to indicate code execution is not available
            messages.push({
              role: 'user',
              content: `<observation>Code execution is not available in this context. Please provide a text-based response instead.</observation>`
            });
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
              },
              call_id: completionId
            };

            // Get the script tag type that was actually used
            const scriptTagType = getScriptTagType(accumulatedResponse);

            // Add the tool call to messages with XML format
            messages.push({
              role: 'assistant',
              content: `<thoughts>${thoughts}</thoughts>\n<${scriptTagType} id="${completionId}">${scriptContent}</${scriptTagType}>`
            });

            // on Streaming about executing the code
            if(onStreaming){
              onStreaming(completionId, `Executing code...`);
            }

            // Execute the tool call
            try {
              const result = await onExecuteCode(
                completionId,
                scriptContent
              );

              // Yield the tool call output
              yield {
                type: 'function_call_output',
                content: result,
                call_id: completionId
              };

              // Add tool response to messages
              messages.push({
                role: 'user',
                content: `<observation>I have executed the code. Here are the outputs:\n\`\`\`\n${result}\n\`\`\`\nNow continue with the next step.</observation>`
              });
            } catch (error) {
              console.error('Error executing code:', error);
              const errorMessage = `Error executing code: ${error instanceof Error ? error.message : 'Unknown error'}`;

              yield {
                type: 'error',
                content: errorMessage,
                error: error instanceof Error ? error : new Error(errorMessage)
              };

              // Add error message to messages so the model can attempt recovery
              messages.push({
                role: 'user',
                content: `<observation>Error executing the code: ${error instanceof Error ? error.message : 'Unknown error'}\nPlease try a different approach.</observation>`
              });
            }
          }
        }
        else{
          // If we have an empty response, skip this iteration entirely
          if (accumulatedResponse.trim().length === 0) {
            console.log('DEBUG: Skipping empty response - not adding to messages');
            // Don't add empty responses to messages array - just break out of loop
            break;
          }

          // Check if response contains any special tags
          const hasThoughts = extractThoughts(accumulatedResponse);
          const hasSpecialTags = hasThoughts || 
                                accumulatedResponse.includes('<py-script') ||
                                accumulatedResponse.includes('<js-script') ||
                                accumulatedResponse.includes('<t-script') ||
                                accumulatedResponse.includes('<script') ||
                                accumulatedResponse.includes('<returnToUser');
          
          if (!hasSpecialTags && accumulatedResponse.trim().length > 0) {
            // Plain text response without any special tags - inject guidance message
            console.log('DEBUG: Detected naked response without proper tags, injecting guidance message');
            
            guidanceCount++;
            if (guidanceCount > 3) {
              console.log('DEBUG: Too many guidance attempts, forcing return to user');
              // Force a return to user to prevent infinite guidance loops
              if(onMessage){
                onMessage(completionId, `The assistant seems to be having trouble following the proper format. Please try rephrasing your request or being more specific about what you need.`, []);
              }
              yield {
                type: 'text',
                content: `The assistant seems to be having trouble following the proper format. Please try rephrasing your request or being more specific about what you need.`
              };
              break;
            }
            
            // Add the assistant's response to the conversation
            messages.push({
              role: 'assistant',
              content: accumulatedResponse
            });
            
            // Inject user message with guidance about proper tag usage
            const guidanceMessage = 'Please continue your response with proper tags. Available tags:\n' +
                        '- <thoughts>your analysis</thoughts> - for planning and analysis\n' +
                        '- <py-script id="unique_id">python_code</py-script> - for Python code execution\n' +
                        '- <t-script id="unique_id">typescript_code</t-script> - for TypeScript/JavaScript code execution\n' +
                        '- <returnToUser commit="id1,id2">final_response</returnToUser> - for final answers\n';
            
            messages.push({
              role: 'user',
              content: guidanceMessage
            });
            
            // Yield progress indicator so consumer knows we're still active
            yield {
              type: 'text_chunk',
              content: '' // Empty chunk to indicate processing
            };
            
            // Continue the loop to get a proper response with tags
            // Don't increment loopCount here since this is just guidance
          } else if (hasSpecialTags) {
            // Has special tags but no executable content - this is incomplete response
            console.log('DEBUG: Response has tags but no executable content, treating as incomplete');
            
            guidanceCount++;
            if (guidanceCount > 3) {
              console.log('DEBUG: Too many guidance attempts, forcing return to user');
              // Force a return to user to prevent infinite guidance loops
              if(onMessage){
                onMessage(completionId, `The assistant seems to be having trouble following the proper format. Please try rephrasing your request or being more specific about what you need.`, []);
              }
              yield {
                type: 'text',
                content: `The assistant seems to be having trouble following the proper format. Please try rephrasing your request or being more specific about what you need.`
              };
              break;
            }
            
            // Add the assistant's response to the conversation
            messages.push({
              role: 'assistant',
              content: accumulatedResponse
            });
            
            // Add user message requesting completion
            messages.push({
              role: 'user',
              content: 'Your response appears incomplete. Please continue with executable code using <py-script> or <t-script> tags, or provide a final answer using <returnToUser> tags.'
            });
            
            // Don't increment loopCount here since this is just guidance
          } else {
            // This shouldn't happen, but if it does, add the response and break
            console.log('DEBUG: Unexpected response format, adding to conversation and breaking');
            messages.push({
              role: 'assistant',
              content: accumulatedResponse
            });
            break;
          }
        }
        
        // Only count this as a step if we processed meaningful content (script execution or return to user)
        const hasExecutableContent = extractScript(accumulatedResponse) || extractReturnToUser(accumulatedResponse);
        if (hasExecutableContent) {
          loopCount++;
        }
        
        // add a reminder message if we are approaching the max steps
        if(loopCount >= maxSteps - 2){
          messages.push({
            role: 'user',
            content: `You are approaching the maximum number of steps (${maxSteps}). Please conclude the session with \`returnToUser\` tag and commit the current code and outputs, otherwise the session will be aborted.`
          });
        }

        // Check if we've hit the loop limit
        if (loopCount >= maxSteps) {
          console.warn(`Chat completion reached maximum loop limit of ${maxSteps}`);
          if(onMessage){
            onMessage(completionId, `<thoughts>Maximum steps reached</thoughts>\n<returnToUser>Reached maximum number of tool calls (${maxSteps}). Some actions may not have completed. I'm returning control to you now. Please try breaking your request into smaller steps or provide additional guidance.</returnToUser>`, []);
          }
          yield {
            type: 'text',
            content: `<thoughts>Maximum steps reached</thoughts>\n<returnToUser>Reached maximum number of tool calls (${maxSteps}). Some actions may not have completed. I'm returning control to you now. Please try breaking your request into smaller steps or provide additional guidance.</returnToUser>`
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

