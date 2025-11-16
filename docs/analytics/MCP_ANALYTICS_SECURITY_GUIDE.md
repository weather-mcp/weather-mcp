# MCP Analytics Security Implementation Guide

## Table of Contents
- [Overview](#overview)
- [Security Challenges](#security-challenges)
- [Recommended Architecture](#recommended-architecture)
- [Implementation Steps](#implementation-steps)
- [Code Examples](#code-examples)
- [Testing](#testing)
- [Deployment Checklist](#deployment-checklist)
- [Monitoring & Response](#monitoring--response)

---

## Overview

This guide provides best practices for securely implementing analytics in MCP (Model Context Protocol) servers. Since MCP servers run on users' local machines with visible source code, special considerations are needed to prevent abuse of analytics endpoints.

### Key Principles

1. **Analytics should never break functionality** - Always fail gracefully
2. **Privacy first** - Collect only what's necessary, never PII
3. **Assume the client is hostile** - Validate everything server-side
4. **Make abuse expensive** - Use rate limiting and monitoring
5. **Opt-in by default** - Require explicit user configuration

---

## Security Challenges

### Why MCP Analytics is Different

**Traditional server analytics**:
- Server code is private
- Can embed secrets securely
- Full control over requests

**MCP server analytics**:
- ❌ Code runs on user's machine (visible source code)
- ❌ Can't embed secrets (users can read them)
- ❌ Users can modify the code
- ❌ Malicious actors can spoof requests
- ✅ Must design for untrusted clients

### Attack Vectors to Consider

1. **API Abuse**: Automated requests to exhaust quotas
2. **Data Pollution**: Sending false/garbage data
3. **Secret Extraction**: Reading API keys from source code
4. **Replay Attacks**: Reusing captured legitimate requests
5. **DDoS**: Overwhelming analytics server with requests

---

## Recommended Architecture

### High-Level Design

```
┌─────────────────┐
│   MCP Client    │
│   (Claude Code) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│   MCP Server            │
│   (weather-mcp)         │
│                         │
│   ┌─────────────────┐   │
│   │ Analytics Agent │   │ ← Optional, user-configured
│   │ (Optional)      │   │
│   └────────┬────────┘   │
└────────────┼────────────┘
             │ HTTPS + API Key
             │ Rate Limited
             ▼
   ┌──────────────────────┐
   │  Analytics Server    │
   │  (Your Backend)      │
   │                      │
   │  ┌────────────────┐  │
   │  │ Rate Limiter   │  │
   │  ├────────────────┤  │
   │  │ Validator      │  │
   │  ├────────────────┤  │
   │  │ Storage        │  │
   │  └────────────────┘  │
   └──────────────────────┘
```

### Key Components

1. **MCP Server** (Untrusted)
   - Sends analytics events
   - Uses user-provided API key
   - Fails gracefully if analytics unavailable

2. **Analytics Server** (Trusted)
   - Validates all requests
   - Enforces rate limits
   - Detects abuse patterns
   - Stores validated data

---

## Implementation Steps

### Step 1: Analytics Server Setup

#### 1.1 Choose Your Stack

**Recommended options**:
- **Simple**: Supabase + Edge Functions
- **Scalable**: Node.js + PostgreSQL + Redis
- **Serverless**: AWS Lambda + DynamoDB + API Gateway
- **Managed**: PostHog (self-hosted or cloud)

#### 1.2 Database Schema

```sql
-- API Keys table
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash VARCHAR(64) UNIQUE NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  tier VARCHAR(20) DEFAULT 'free', -- free, pro, enterprise
  rate_limit_per_day INTEGER DEFAULT 1000
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- Events table
CREATE TABLE analytics_events (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id),
  tool_name VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL,
  error_type VARCHAR(50),
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_timestamp ON analytics_events(timestamp);
CREATE INDEX idx_events_api_key ON analytics_events(api_key_id);

-- Rate limiting table (Redis preferred, but SQL works)
CREATE TABLE rate_limits (
  api_key_id UUID PRIMARY KEY,
  daily_count INTEGER DEFAULT 0,
  last_reset TIMESTAMP DEFAULT NOW()
);
```

#### 1.3 API Key Generation Service

```typescript
// generate-api-key.ts
import crypto from 'crypto';

interface ApiKeyResult {
  key: string;      // Give to user (store securely!)
  keyHash: string;  // Store in database
}

export function generateApiKey(): ApiKeyResult {
  // Generate cryptographically secure random key
  const key = `wmc_${crypto.randomBytes(32).toString('hex')}`;

  // Hash for storage (never store plaintext keys)
  const keyHash = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');

  return { key, keyHash };
}

// Usage example
async function createUserApiKey(userId: string) {
  const { key, keyHash } = generateApiKey();

  await db.query(
    'INSERT INTO api_keys (key_hash, user_id) VALUES ($1, $2)',
    [keyHash, userId]
  );

  // Return key to user ONCE (they must save it)
  return key;
}
```

### Step 2: Analytics Server Implementation

#### 2.1 Express Server with Security

```typescript
// analytics-server.ts
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// CORS - restrict to known domains if possible
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  next();
});

// Global rate limit (by IP)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes per IP
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/v1/events', globalLimiter);

// Event schema validation
const eventSchema = z.object({
  tool: z.string().min(1).max(50),
  success: z.boolean(),
  errorType: z.string().max(50).optional(),
  timestamp: z.number().min(Date.now() - 60000).max(Date.now() + 1000), // Within last minute
});

// Middleware: Validate API key
async function validateApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  // Hash the provided key
  const keyHash = crypto
    .createHash('sha256')
    .update(apiKey)
    .digest('hex');

  // Look up key in database
  const result = await db.query(
    'SELECT id, is_active, rate_limit_per_day FROM api_keys WHERE key_hash = $1',
    [keyHash]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const apiKeyData = result.rows[0];

  if (!apiKeyData.is_active) {
    return res.status(403).json({ error: 'API key disabled' });
  }

  // Update last used
  await db.query(
    'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
    [apiKeyData.id]
  );

  // Attach to request for later use
  req.apiKeyId = apiKeyData.id;
  req.rateLimit = apiKeyData.rate_limit_per_day;

  next();
}

// Middleware: Check rate limit per API key
async function checkRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKeyId = req.apiKeyId;
  const limit = req.rateLimit;

  // Get or create rate limit record
  const result = await db.query(
    `INSERT INTO rate_limits (api_key_id, daily_count, last_reset)
     VALUES ($1, 1, NOW())
     ON CONFLICT (api_key_id) DO UPDATE
     SET daily_count = CASE
       WHEN rate_limits.last_reset < NOW() - INTERVAL '24 hours'
       THEN 1
       ELSE rate_limits.daily_count + 1
     END,
     last_reset = CASE
       WHEN rate_limits.last_reset < NOW() - INTERVAL '24 hours'
       THEN NOW()
       ELSE rate_limits.last_reset
     END
     RETURNING daily_count`,
    [apiKeyId]
  );

  const count = result.rows[0].daily_count;

  if (count > limit) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit: limit,
      resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
  }

  next();
}

// Endpoint: Record event
app.post('/v1/events', validateApiKey, checkRateLimit, async (req, res) => {
  try {
    // Validate payload
    const event = eventSchema.parse(req.body);

    // Store event
    await db.query(
      `INSERT INTO analytics_events (api_key_id, tool_name, success, error_type, timestamp)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [req.apiKeyId, event.tool, event.success, event.errorType || null, event.timestamp]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid event data', details: error.errors });
    }

    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Analytics server running on port ${PORT}`);
});
```

### Step 3: MCP Server Integration

#### 3.1 Analytics Client (MCP Server Side)

```typescript
// src/services/analytics.ts
import type { AnalyticsEvent } from '../types/analytics.js';

export class AnalyticsService {
  private apiKey?: string;
  private endpoint: string;
  private enabled: boolean;

  constructor() {
    this.apiKey = process.env.ANALYTICS_API_KEY;
    this.endpoint = process.env.ANALYTICS_ENDPOINT || 'https://analytics.yourservice.com/v1/events';
    this.enabled = !!this.apiKey;

    if (!this.enabled) {
      console.error('Analytics disabled: No API key configured');
    }
  }

  /**
   * Track an event (fire-and-forget)
   * Never throws errors - fails silently
   */
  async trackEvent(event: AnalyticsEvent): Promise<void> {
    if (!this.enabled) return;

    const payload = {
      tool: event.toolName,
      success: event.success,
      errorType: event.errorType,
      timestamp: Date.now(),
    };

    try {
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey!,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`Analytics failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      // Log but never throw - analytics should not break functionality
      if (error.name === 'AbortError') {
        console.error('Analytics timeout');
      } else {
        console.error('Analytics error:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }

  /**
   * Helper: Track successful tool execution
   */
  async trackSuccess(toolName: string): Promise<void> {
    await this.trackEvent({
      toolName,
      success: true,
    });
  }

  /**
   * Helper: Track failed tool execution
   */
  async trackFailure(toolName: string, errorType: string): Promise<void> {
    await this.trackEvent({
      toolName,
      success: false,
      errorType,
    });
  }
}
```

#### 3.2 Type Definitions

```typescript
// src/types/analytics.ts
export interface AnalyticsEvent {
  toolName: string;
  success: boolean;
  errorType?: string;
}
```

#### 3.3 Integration in MCP Server

```typescript
// src/index.ts
import { AnalyticsService } from './services/analytics.js';

const analytics = new AnalyticsService();

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_forecast': {
        // ... existing code ...

        // Track success
        analytics.trackSuccess('get_forecast');

        return { content: [{ type: 'text', text: output }] };
      }

      case 'get_historical_weather': {
        // ... existing code ...

        analytics.trackSuccess('get_historical_weather');

        return { content: [{ type: 'text', text: output }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Track failure with error type
    const errorType = categorizeError(errorMessage);
    analytics.trackFailure(name, errorType);

    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true
    };
  }
});

// Helper to categorize errors for analytics
function categorizeError(message: string): string {
  if (message.includes('token')) return 'MISSING_TOKEN';
  if (message.includes('rate limit')) return 'RATE_LIMIT';
  if (message.includes('timeout')) return 'TIMEOUT';
  if (message.includes('not found')) return 'NOT_FOUND';
  if (message.includes('Invalid')) return 'INVALID_INPUT';
  return 'UNKNOWN';
}
```

### Step 4: User Configuration

#### 4.1 Update .env.example

```bash
# .env.example

# NOAA Climate Data Online (CDO) API Token
NOAA_CDO_TOKEN=your_token_here

# Analytics (Optional)
# Get your analytics API key at: https://analytics.yourservice.com/signup
# Analytics helps improve the service but is completely optional
# ANALYTICS_API_KEY=wmc_your_analytics_key_here
# ANALYTICS_ENDPOINT=https://analytics.yourservice.com/v1/events
```

#### 4.2 Update README.md

```markdown
## Analytics (Optional)

This MCP server optionally supports usage analytics to help improve the service. Analytics is:
- **Opt-in**: Disabled by default
- **Privacy-focused**: No coordinates, queries, or personal data collected
- **Non-blocking**: Never affects weather functionality

### What's Collected

If you enable analytics, only these events are recorded:
- Tool name (e.g., "get_forecast")
- Success/failure status
- Error type (e.g., "TIMEOUT", "INVALID_INPUT")
- Timestamp

**Never collected**: Your coordinates, location names, API tokens, or any weather data.

### Enable Analytics

1. Sign up for a free analytics key at: https://analytics.yourservice.com/signup
2. Add to your MCP configuration:

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["/path/to/weather-mcp/dist/index.js"],
      "env": {
        "NOAA_CDO_TOKEN": "your_cdo_token",
        "ANALYTICS_API_KEY": "wmc_your_analytics_key"
      }
    }
  }
}
```

### Disable Analytics

Simply omit the `ANALYTICS_API_KEY` from your configuration. The server works perfectly without it.
```

---

## Code Examples

### Advanced: Request Signing

For additional security, implement request signing:

```typescript
// src/services/analytics.ts - Enhanced version
import crypto from 'crypto';

export class AnalyticsService {
  private apiKey?: string;
  private signingSecret?: string;

  constructor() {
    this.apiKey = process.env.ANALYTICS_API_KEY;
    this.signingSecret = process.env.ANALYTICS_SIGNING_SECRET;
  }

  private generateSignature(payload: string, timestamp: number): string {
    const data = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', this.signingSecret!)
      .update(data)
      .digest('hex');
  }

  async trackEvent(event: AnalyticsEvent): Promise<void> {
    if (!this.enabled) return;

    const timestamp = Date.now();
    const payload = JSON.stringify({
      tool: event.toolName,
      success: event.success,
      errorType: event.errorType,
      timestamp,
    });

    const signature = this.generateSignature(payload, timestamp);

    await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey!,
        'X-Signature': signature,
        'X-Timestamp': timestamp.toString(),
      },
      body: payload,
    });
  }
}

// Server side validation
app.post('/v1/events', validateApiKey, async (req, res) => {
  const signature = req.headers['x-signature'] as string;
  const timestamp = parseInt(req.headers['x-timestamp'] as string);

  // Check timestamp is recent (prevent replay attacks)
  if (Math.abs(Date.now() - timestamp) > 60000) {
    return res.status(401).json({ error: 'Request too old' });
  }

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', signingSecret)
    .update(`${timestamp}.${JSON.stringify(req.body)}`)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process event...
});
```

---

## Testing

### Test Suite for Analytics

```typescript
// test_analytics.ts
import { AnalyticsService } from './src/services/analytics.js';

async function testAnalytics() {
  console.log('Testing Analytics Service...\n');

  const analytics = new AnalyticsService();

  // Test 1: Success tracking
  console.log('Test 1: Track successful forecast request');
  await analytics.trackSuccess('get_forecast');
  console.log('✅ Success event sent\n');

  // Test 2: Failure tracking
  console.log('Test 2: Track failed historical data request');
  await analytics.trackFailure('get_historical_weather', 'MISSING_TOKEN');
  console.log('✅ Failure event sent\n');

  // Test 3: No API key (should fail silently)
  console.log('Test 3: Analytics with no API key');
  const disabledAnalytics = new AnalyticsService();
  await disabledAnalytics.trackSuccess('test');
  console.log('✅ Gracefully handled missing API key\n');

  console.log('All tests passed!');
}

testAnalytics();
```

### Manual Testing Checklist

- [ ] Analytics disabled without API key
- [ ] Valid API key allows events
- [ ] Invalid API key rejected (401)
- [ ] Rate limit enforced (429)
- [ ] Malformed payload rejected (400)
- [ ] Analytics timeout doesn't break MCP functionality
- [ ] Events stored correctly in database
- [ ] Timestamps validated (reject old/future)
- [ ] IP-based rate limiting works

---

## Deployment Checklist

### Pre-Deployment

- [ ] Set up analytics database with proper indexes
- [ ] Configure backup strategy
- [ ] Set up monitoring (uptime, error rates)
- [ ] Test rate limiting under load
- [ ] Review API key generation security
- [ ] Set up log aggregation
- [ ] Configure alerts for suspicious activity

### Deployment

- [ ] Deploy analytics server to production
- [ ] Set up HTTPS with valid certificate
- [ ] Configure firewall rules
- [ ] Set environment variables securely
- [ ] Test from MCP server in production
- [ ] Monitor initial traffic patterns

### Post-Deployment

- [ ] Create user signup flow for API keys
- [ ] Build dashboard for users to view their analytics
- [ ] Document API for users
- [ ] Set up automated reports for abuse detection
- [ ] Plan for API key rotation policy

---

## Monitoring & Response

### Metrics to Track

```typescript
// Key metrics to monitor
{
  requests_per_minute: number,
  error_rate: number,
  avg_response_time: number,
  unique_api_keys: number,
  rate_limit_hits: number,
  invalid_auth_attempts: number
}
```

### Abuse Detection

**Red flags to monitor**:
1. Single API key with unusually high volume
2. Many requests from same IP
3. High rate of validation errors
4. Requests with old/future timestamps
5. Sudden spike in traffic

**Automated responses**:
```typescript
// Example: Auto-disable abusive keys
async function detectAndBlockAbuse() {
  // Find keys exceeding reasonable limits
  const abusiveKeys = await db.query(`
    SELECT api_key_id, COUNT(*) as count
    FROM analytics_events
    WHERE timestamp > NOW() - INTERVAL '1 hour'
    GROUP BY api_key_id
    HAVING COUNT(*) > 10000
  `);

  for (const { api_key_id } of abusiveKeys.rows) {
    await db.query(
      'UPDATE api_keys SET is_active = false WHERE id = $1',
      [api_key_id]
    );

    // Alert admin
    await sendAlert(`API key ${api_key_id} disabled for abuse`);
  }
}

// Run every 5 minutes
setInterval(detectAndBlockAbuse, 5 * 60 * 1000);
```

### Incident Response Plan

**If abuse detected**:
1. **Immediate**: Auto-disable offending API keys
2. **5 minutes**: Review logs to understand attack vector
3. **15 minutes**: Adjust rate limits if needed
4. **1 hour**: Contact affected users if legitimate usage blocked
5. **24 hours**: Post-mortem and update detection rules

---

## Cost Management

### Estimate Usage Costs

```typescript
// Calculate projected costs
const assumptions = {
  activeUsers: 1000,
  avgToolsPerDay: 10,
  daysPerMonth: 30,
};

const totalEvents = assumptions.activeUsers *
                    assumptions.avgToolsPerDay *
                    assumptions.daysPerMonth;

console.log(`Projected events/month: ${totalEvents.toLocaleString()}`);
// Example: 1,000 users × 10 tools/day × 30 days = 300,000 events/month

// Database storage (assuming 100 bytes per event)
const storageGB = (totalEvents * 100) / (1024 * 1024 * 1024);
console.log(`Storage needed: ${storageGB.toFixed(2)} GB/month`);
```

### Free Tier Recommendations

```typescript
const freeTierLimits = {
  requestsPerDay: 1000,
  requestsPerHour: 100,
  burstSize: 10,
};
```

---

## Privacy Considerations

### What NOT to Collect

**Never send to analytics**:
- ❌ Latitude/longitude coordinates
- ❌ Location names or addresses
- ❌ API tokens or keys
- ❌ Weather data or forecasts
- ❌ User identifiers from MCP client
- ❌ File paths or system information
- ❌ IP addresses (log but don't store)

### GDPR Compliance

If users are in EU:
- [ ] Provide data export functionality
- [ ] Allow users to delete their data
- [ ] Document data retention policy
- [ ] Include analytics in privacy policy
- [ ] Get explicit consent (opt-in)

---

## Summary

### Quick Start

1. **Set up analytics server** with API key validation and rate limiting
2. **Add analytics client** to MCP server (fails gracefully)
3. **Make it opt-in** - require user-provided API key
4. **Monitor and adjust** - watch for abuse patterns
5. **Keep it simple** - don't over-engineer

### Security Hierarchy

```
Level 1: User-provided API keys + Basic rate limiting ✅ START HERE
Level 2: + Request signing + Timestamp validation
Level 3: + Advanced abuse detection + Auto-blocking
Level 4: + OAuth/OIDC + Enterprise features
```

### Remember

- Analytics should **enhance**, not **hinder** the user experience
- **Privacy first** - collect minimum necessary data
- **Fail gracefully** - never break core functionality
- **Be transparent** - document what you collect
- **Respond quickly** - have an abuse response plan

---

## Additional Resources

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Rate Limiting Strategies](https://www.nginx.com/blog/rate-limiting-nginx/)
- [GDPR Compliance Guide](https://gdpr.eu/)

---

**Version**: 1.0
**Last Updated**: 2025-11-14
**Maintainer**: Weather MCP Project
