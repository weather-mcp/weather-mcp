# MCP Best Practices for Service Status Communication

This document outlines best practices for communicating API service status to AI clients through the Model Context Protocol (MCP).

## Overview

According to MCP documentation:
> "Tool errors should be reported within the result object, not as MCP protocol-level errors. This allows the LLM to see and potentially take corrective action or request human intervention."

The goal is to ensure AI clients can:
1. **Detect** when a service is offline or degraded
2. **Understand** the nature and scope of the issue
3. **Communicate** the problem clearly to end users
4. **Take action** to resolve or work around the issue

## MCP Error Handling Patterns

### Pattern 1: Tool-Level Error Responses (Current Implementation)

**When to use:** For errors that occur during tool execution

**Implementation:**
```typescript
try {
  const result = await someAPICall();
  return {
    content: [{ type: 'text', text: formatResult(result) }]
  };
} catch (error) {
  return {
    content: [{
      type: 'text',
      text: `Error: ${error.message}\n\n` +
            `Check service status: https://status.example.com`
    }],
    isError: true  // Critical: tells AI this is an error
  };
}
```

**Why this works:**
- The `isError: true` flag signals to the AI that something went wrong
- The error message is visible to the AI for interpretation
- The AI can decide whether to retry, check status, or inform the user

### Pattern 2: Enhanced Tool Descriptions

**When to use:** Always - guides AI behavior proactively

**Implementation:**
```typescript
{
  name: 'get_weather',
  description: 'Get weather data for a location. ' +
               'If this tool returns an error, check the error message ' +
               'for status page links and consider using check_service_status ' +
               'to check whether the weather APIs answer.',
  inputSchema: { /* ... */ }
}
```

**Why this works:**
- AI reads tool descriptions before calling tools
- Provides guidance on error handling strategies
- Encourages proactive status checking

### Pattern 3: Dedicated Status Check Tool (Recommended)

**When to use:** When you want AI to proactively verify service health

**Implementation:**
```typescript
{
  name: 'check_service_status',
  description: 'Check whether the weather APIs answer, and how. ' +
               'Use this when experiencing errors, to tell a local network failure ' +
               'from an upstream error before making weather data requests.',
  inputSchema: { type: 'object', properties: {}, required: [] }
}
```

**Why this works:**
- AI can call this tool without user prompt when errors occur
- Provides structured status information
- Enables intelligent error recovery (e.g., "Service is down, I'll check back later")

### Pattern 4: Resource-Based Status (Advanced - Optional)

**When to use:** For real-time status that AI can check without calling a tool

**Implementation:**
```typescript
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'status://api-health',
        name: 'API Health Status',
        description: 'Whether each weather API answered, and how',
        mimeType: 'application/json'
      }
    ]
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'status://api-health') {
    const noaaStatus = await noaaService.checkServiceStatus();
    const openMeteoStatus = await openMeteoService.checkServiceStatus();

    return {
      contents: [{
        uri: 'status://api-health',
        mimeType: 'application/json',
        text: JSON.stringify({
          noaa: noaaStatus,
          openMeteo: openMeteoStatus,
          timestamp: new Date().toISOString()
        }, null, 2)
      }]
    };
  }
  throw new Error('Resource not found');
});
```

**Why this works:**
- Resources are lower-cost than tool calls
- AI can check status frequently without explicit user commands
- Enables background monitoring and proactive error handling

## Error Message Best Practices

### 1. Structure Your Error Messages

**Good:**
```
NOAA API server error: Service temporarily unavailable

The NOAA Weather API may be experiencing an outage.

Check service status:
- Planned outages: https://weather-gov.github.io/api/planned-outages
- Service notices: https://www.weather.gov/notification
- Report issues: nco.ops@noaa.gov or (301) 683-1518
```

**Why it's good:**
- Clear problem statement
- Context about what might be wrong
- Actionable links
- Multiple ways to get information

**Bad:**
```
Error: 503 Service Unavailable
```

**Why it's bad:**
- No context
- No guidance on next steps
- AI can't communicate this effectively to users

### 2. Include Structured Information

Even though MCP errors are text-based, you can include structured information that AI can parse:

```typescript
const errorMessage = [
  `Error Type: SERVICE_UNAVAILABLE`,
  `Service: NOAA Weather API`,
  ``,
  `The NOAA Weather API is currently experiencing issues.`,
  ``,
  `Status Page: https://weather-gov.github.io/api/planned-outages`,
  `Estimated Resolution: Check status page for updates`,
  ``,
  `Alternative: For historical data, Open-Meteo API may still be available.`
].join('\n');
```

### 3. Categorize Errors

Help AI understand the severity and nature of errors:

```typescript
enum ErrorCategory {
  TEMPORARY = 'TEMPORARY',     // Retry might work
  PERMANENT = 'PERMANENT',     // Won't work without changes
  DEGRADED = 'DEGRADED',       // Partial functionality
  EXTERNAL = 'EXTERNAL'        // Outside our control
}

const errorMessage = `Error Category: ${ErrorCategory.EXTERNAL}\n\n` +
                    `NOAA API is experiencing server issues...`;
```

### 4. Suggest Alternatives

When one service is down, guide AI to alternatives:

```typescript
const errorMessage =
  `NOAA API Error: Service temporarily unavailable\n\n` +
  `Suggestion: For historical weather data (>7 days old), ` +
  `try using get_historical_weather which uses Open-Meteo API ` +
  `(global coverage, independent service).\n\n` +
  `Status: https://weather-gov.github.io/api/planned-outages`;
```

## AI Client Behavior Expectations

Based on MCP design, here's how AI clients typically respond to errors:

### 1. Error Detection
```
Tool returns { isError: true, content: [...] }
→ AI knows something went wrong
```

### 2. Error Analysis
```
AI reads the error message text
→ Looks for patterns: "service unavailable", "timeout", "rate limit"
→ Identifies status page links
```

### 3. Response Generation
```
Good AI response:
"I tried to get the weather forecast, but the NOAA Weather API is
currently experiencing an outage. According to their status page
(https://weather-gov.github.io/api/planned-outages), they're aware
of the issue. Would you like me to check again in a few minutes,
or try getting historical data instead?"

Poor AI response:
"Error: Service unavailable."
```

### 4. Proactive Recovery
```
If tool description mentions check_service_status:
→ AI may automatically call it after errors
→ Can make informed decisions about retry timing
→ Can communicate ETA to users if status page provides it
```

## Implementation Checklist

- [x] **Tool errors use `isError: true` flag**
- [x] **Error messages include clear problem descriptions**
- [x] **Error messages contain status page links**
- [x] **Error messages suggest concrete next steps**
- [x] **Tool descriptions mention error handling strategies**
- [x] **Dedicated `check_service_status` tool available**
- [ ] **Consider: Resources for real-time status (optional)**
- [ ] **Consider: Error categorization (TEMPORARY, PERMANENT, etc.)**
- [ ] **Consider: Alternative service suggestions in errors**

## Real-World Example Flow

**Scenario:** NOAA API is down

1. **User asks:** "What's the weather in New York?"

2. **AI calls:** `get_current_conditions(lat: 40.7128, lon: -74.0060)`

3. **MCP Server returns:**
```json
{
  "content": [{
    "type": "text",
    "text": "NOAA API server error: Service temporarily unavailable\n\nThe NOAA Weather API may be experiencing an outage.\n\nCheck service status:\n- Planned outages: https://weather-gov.github.io/api/planned-outages\n- Service notices: https://www.weather.gov/notification\n- Report issues: nco.ops@noaa.gov or (301) 683-1518"
  }],
  "isError": true
}
```

4. **AI (good behavior):**
   - Reads error message
   - Sees it's a service outage
   - Notes the status page link
   - Decides to check service status

5. **AI calls:** `check_service_status()`

6. **MCP Server returns:** Status showing NOAA is down, Open-Meteo is up

7. **AI responds to user:**
   > "I'm unable to get the current weather for New York right now because the NOAA Weather API is experiencing an outage. According to their status page, they're aware of the issue.
   >
   > However, I can get historical weather data for New York if you'd like to know what the weather was like in recent days or weeks. Would that be helpful?"

## Benefits of This Approach

1. **Graceful Degradation:** AI can work around failures
2. **User Communication:** AI explains issues clearly in natural language
3. **Reduced Frustration:** Users get context, not cryptic errors
4. **Self-Service:** AI can check status and retry without user intervention
5. **Intelligent Recovery:** AI knows when to retry vs. when to give up

## Common Pitfalls to Avoid

❌ **Don't:** Throw protocol-level exceptions for API errors
```typescript
// Bad
throw new Error('API is down');  // This breaks the MCP connection
```

✅ **Do:** Return errors within the result object
```typescript
// Good
return {
  isError: true,
  content: [{ type: 'text', text: 'API is down...' }]
};
```

❌ **Don't:** Return generic error messages
```typescript
// Bad
return {
  isError: true,
  content: [{ type: 'text', text: 'Error occurred' }]
};
```

✅ **Do:** Provide context and actionable information
```typescript
// Good
return {
  isError: true,
  content: [{
    type: 'text',
    text: 'NOAA API unavailable. Check status: https://...'
  }]
};
```

❌ **Don't:** Assume AI will know what to do
```typescript
// Bad - no guidance
description: 'Get weather forecast'
```

✅ **Do:** Guide AI behavior in tool descriptions
```typescript
// Good - the pointer lives once, on the status tool itself
description: 'Check whether the upstream weather APIs (NOAA, Open-Meteo) are reachable. Call this after any weather tool returns an error, or before a batch of requests. Returns per-service status and links to the official status pages.'
```

Put the error-handling pointer on `check_service_status`, not on every weather tool.
A model reads the description of every enabled tool, so one pointer reaches it — and
repeating the clause per tool costs bytes in every client's context on every turn while
pointing at a tool the model cannot call at all when `ENABLED_TOOLS` omits it.

## Conclusion

The best practice for MCP servers is to use a **layered approach**:

1. **Tool-level errors** with `isError: true` and detailed messages
2. **`check_service_status`'s own description**, which is where the error-handling guidance lives — a single pointer rather than a clause repeated on every tool
3. **Dedicated status check tools** for proactive monitoring
4. **Optional: Resources** for real-time status without tool calls

Our current implementation uses patterns 1-3, which aligns with MCP best practices and enables AI clients to handle service outages intelligently.
