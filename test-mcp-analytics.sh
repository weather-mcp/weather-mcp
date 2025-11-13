#!/bin/bash
# Test script to verify MCP server sends analytics to local analytics-server
#
# Prerequisites:
# 1. Analytics server running on localhost:3100
# 2. .env file configured with ANALYTICS_ENDPOINT=http://localhost:3100/v1/events
#
# This script will:
# 1. Start the MCP server
# 2. Send a test request
# 3. Check if analytics event was received

set -e

echo "=========================================="
echo "MCP Server Analytics Test"
echo "=========================================="
echo ""

# Check if analytics server is running
echo "1. Checking if analytics server is running on localhost:3100..."
if ! curl -s http://localhost:3100/v1/health > /dev/null; then
  echo "❌ Analytics server is not running on localhost:3100"
  echo "   Please start the analytics server first:"
  echo "   cd /home/dgahagan/work/personal/weather-mcp/analytics-server"
  echo "   npm run dev"
  exit 1
fi
echo "✅ Analytics server is running"
echo ""

# Check Redis queue before test
echo "2. Checking Redis queue before test..."
QUEUE_BEFORE=$(docker exec -i analytics-redis-dev redis-cli LLEN events_queue 2>/dev/null || echo "0")
echo "   Events in queue: $QUEUE_BEFORE"
echo ""

# Build the MCP server
echo "3. Building MCP server..."
npm run build > /dev/null 2>&1
echo "✅ Build successful"
echo ""

# Create a simple MCP test request
echo "4. Creating test MCP request..."
cat > /tmp/mcp-test-request.json << 'EOF'
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "check_service_status",
    "arguments": {}
  }
}
EOF
echo "✅ Test request created"
echo ""

# Run the MCP server and send test request
echo "5. Testing MCP server with analytics..."
echo "   Sending check_service_status request..."
echo ""

# Run MCP server in background, send request, then kill it
timeout 10s bash -c '
  node dist/index.js 2>&1 &
  PID=$!
  sleep 2
  cat /tmp/mcp-test-request.json | nc localhost 3000 || true
  sleep 3
  kill $PID 2>/dev/null || true
' | grep -E "Analytics|analytics|INFO|DEBUG" | head -20 || true

echo ""
echo "6. Checking if analytics event was sent..."
sleep 2

# Check Redis queue after test
QUEUE_AFTER=$(docker exec -i analytics-redis-dev redis-cli LLEN events_queue 2>/dev/null || echo "0")
echo "   Events in queue after test: $QUEUE_AFTER"

# Check database for recent events
echo ""
echo "7. Checking database for recent events (last 30 seconds)..."
EVENT_COUNT=$(docker exec -i analytics-postgres-dev psql -U analytics -d analytics -t -c "SELECT COUNT(*) FROM events WHERE timestamp > NOW() - INTERVAL '30 seconds';" 2>/dev/null | tr -d ' ' || echo "0")

echo "   Recent events in database: $EVENT_COUNT"
echo ""

# Check analytics server logs
echo "8. Recent analytics server log entries:"
echo "   (Check the analytics-server terminal for detailed logs)"
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
if [ "$EVENT_COUNT" -gt "0" ]; then
  echo "✅ SUCCESS: Analytics events were received and stored!"
  echo ""
  echo "Recent events:"
  docker exec -i analytics-postgres-dev psql -U analytics -d analytics -c "SELECT tool, status, analytics_level, timestamp FROM events WHERE timestamp > NOW() - INTERVAL '30 seconds' ORDER BY timestamp DESC LIMIT 5;" 2>/dev/null || true
else
  echo "⚠️  No events found in database yet."
  echo "   Events might still be in the queue or being processed."
  echo "   Queue size: $QUEUE_AFTER"
  echo ""
  echo "   Check the analytics-server logs for processing status."
fi

# Cleanup
rm -f /tmp/mcp-test-request.json

echo ""
echo "Test complete!"
