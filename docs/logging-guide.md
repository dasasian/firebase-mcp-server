# Firebase Functions Logging Guide

Query Cloud Functions logs with SQL-like syntax, aggregations, and custom label filtering.

## Overview

The `firebase_functions_logs` tool provides SQL-like queries for Cloud Functions logs through the Google Cloud Logging API. It supports:

- **Discovery queries**: Find what functions exist, identify error patterns
- **Filtering**: WHERE clauses with operators (==, !=, <, >, <=, >=, LIKE, in)
- **Aggregation**: GROUP BY, COUNT, MAX, MIN, DISTINCT
- **Field projection**: Select specific fields to reduce token usage
- **Custom labels**: Filter by user_id, environment, or any custom labels you add
- **Auto-discovery**: Automatically builds schema of functions and labels from queries

## Quick Start

### Basic Discovery

```json
// What functions do I have?
{"distinct": "functionName"}

// What functions are failing?
{
  "groupBy": ["functionName"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "error_count"}],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}]
}

// Top 10 error messages
{
  "groupBy": ["textPayload"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "occurrences"}],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}],
  "orderBy": [{"field": "occurrences", "direction": "desc"}],
  "limit": 10
}
```

### Basic Filtering

```json
// Recent logs (last 100)
{"limit": 100}

// Errors only
{
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}],
  "limit": 50
}

// Specific function logs
{
  "where": [{"field": "functionName", "operator": "==", "value": "sendEmail"}],
  "fields": ["timestamp", "severity", "textPayload"]
}

// Search for keyword
{
  "where": [{"field": "textPayload", "operator": "LIKE", "value": "%timeout%"}]
}
```

## IAM Setup

The service account needs Cloud Logging access, and a Firebase Admin SDK service
account has **none** by default — it is provisioned for Firestore, Auth and Storage
only. So every other tool works and only this one fails, with:

```
Error: 7 PERMISSION_DENIED: Permission denied for all log views
```

### Grant Permission

```bash
# Replace with your project ID and service account email
# (typically firebase-adminsdk-xxxxx@PROJECT_ID.iam.gserviceaccount.com)
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/logging.viewAccessor"
```

`roles/logging.viewer` alone may not be enough: the error names *log views*, and the
`logging.views.access` permission that covers them is in `viewAccessor`. IAM changes
can take a few minutes to take effect, so retry before assuming the role was wrong.

### Verify Permission

```bash
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:SERVICE_ACCOUNT_EMAIL"
```

### Required Roles

| Role | Access Level | Use Case |
|------|--------------|----------|
| `roles/logging.viewAccessor` | Log views | **Recommended** - what this tool needs |
| `roles/logging.viewer` | Standard logs | Often granted too, but may not be sufficient alone |
| `roles/logging.privateLogViewer` | Includes Data Access logs | When Data Access logs needed |

## Query Patterns

### Discovery Queries

Run these FIRST when exploring logs to understand what data exists.

**List all functions**:
```json
{"distinct": "functionName"}
```

**Function health dashboard** (see all functions + severity breakdown):
```json
{
  "groupBy": ["functionName", "severity"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "count"}]
}
```

**Which functions have errors?** (with error counts):
```json
{
  "groupBy": ["functionName"],
  "aggregates": [
    {"field": "*", "operation": "count", "alias": "error_count"},
    {"field": "timestamp", "operation": "max", "alias": "last_error"}
  ],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}],
  "orderBy": [{"field": "error_count", "direction": "desc"}]
}
```

**Top error patterns** (deduplicated):
```json
{
  "groupBy": ["textPayload"],
  "aggregates": [
    {"field": "*", "operation": "count", "alias": "occurrences"},
    {"field": "timestamp", "operation": "max", "alias": "last_seen"}
  ],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}],
  "orderBy": [{"field": "occurrences", "direction": "desc"}],
  "limit": 10
}
```

### Filtering with WHERE

**Filter by severity**:
```json
{
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}]
}
```

**Severity levels**: ERROR, WARNING, INFO, DEBUG, CRITICAL, ALERT, EMERGENCY

**Filter by function name**:
```json
{
  "where": [{"field": "functionName", "operator": "==", "value": "sendEmail"}]
}
```

**Multiple functions** (IN operator):
```json
{
  "where": [
    {"field": "functionName", "operator": "in", "value": ["sendEmail", "processOrder"]}
  ]
}
```

**Time range** (last hour):
```json
{
  "where": [
    {"field": "timestamp", "operator": ">", "value": "2026-01-13T14:00:00Z"}
  ]
}
```

**Text search** (LIKE with % wildcards):
```json
{
  "where": [
    {"field": "textPayload", "operator": "LIKE", "value": "%timeout%"}
  ]
}
```

**Combine filters** (AND logic):
```json
{
  "where": [
    {"field": "functionName", "operator": "==", "value": "sendEmail"},
    {"field": "severity", "operator": "==", "value": "ERROR"},
    {"field": "timestamp", "operator": ">", "value": "2026-01-13T14:00:00Z"}
  ]
}
```

### Queryable Fields

| Field | Description | Example Values |
|-------|-------------|----------------|
| `functionName` | Cloud Function name | "sendEmail", "processOrder" |
| `severity` | Log severity level | ERROR, WARNING, INFO, DEBUG |
| `timestamp` | Log entry timestamp | "2026-01-13T15:30:00Z" |
| `message` | Log text, from whichever payload holds it | "Error sending email: timeout" |
| `textPayload` | Unstructured log text (plain `console.log`) | "Error sending email: timeout" |
| `jsonPayload` | Structured log data | {"error": "timeout", "userId": "123"} |
| `executionId` | Function execution ID | "abc123..." |
| `region` | Cloud region | "us-central1" |
| `labels.*` | Custom labels (see Labels section) | "labels.user_id", "labels.environment" |

**Prefer `message` over `textPayload`.** Firebase's structured logger (and
`firebase-structured-logger`) writes `jsonPayload.message` and no `textPayload` at all,
so a query that selects `textPayload` on a v2 function returns entries with no text in
them — which reads as "these logs are empty" rather than "wrong field". `message` is
whichever of the two the entry carries. Asking for `textPayload` now falls back to
`message`, in projections, `LIKE` searches and `GROUP BY` alike, but naming `message`
is clearer.

**Cloud Audit Logs are excluded by default.** Deploy and admin-activity entries carry a
protobuf payload that serialises to hundreds of kilobytes of raw bytes and is rarely
what a function debug session wants. Pass `{"includeAuditLogs": true}` to include them;
binary blobs in any payload are replaced with a `<Buffer N bytes>` placeholder.

### Aggregation

**GROUP BY syntax**:
```json
{
  "groupBy": ["field1", "field2"],
  "aggregates": [
    {"field": "*", "operation": "count", "alias": "count"},
    {"field": "timestamp", "operation": "max", "alias": "last_seen"}
  ]
}
```

**Available operations**:
- `count`: Count of entries in group (use "*" as field)
- `max`: Maximum value of field in group
- `min`: Minimum value of field in group

**Example - Error rate by function**:
```json
{
  "groupBy": ["functionName", "severity"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "count"}],
  "orderBy": [{"field": "count", "direction": "desc"}]
}
```

**Example - When was each function last seen?**:
```json
{
  "groupBy": ["functionName"],
  "aggregates": [
    {"field": "timestamp", "operation": "max", "alias": "last_execution"}
  ]
}
```

### Field Projection

Reduce token usage by selecting only needed fields.

**Full logs** (all fields):
```json
{"limit": 10}
```

**Projected logs** (only timestamp, severity, message):
```json
{
  "fields": ["timestamp", "severity", "textPayload"],
  "limit": 10
}
```

**Nested field projection** (specific labels):
```json
{
  "fields": ["timestamp", "textPayload", "labels.user_id", "labels.environment"],
  "limit": 10
}
```

### Ordering and Limits

**Order by timestamp** (most recent first):
```json
{
  "orderBy": [{"field": "timestamp", "direction": "desc"}],
  "limit": 50
}
```

**Order by aggregate results**:
```json
{
  "groupBy": ["textPayload"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "occurrences"}],
  "orderBy": [{"field": "occurrences", "direction": "desc"}],
  "limit": 10
}
```

**Limits**:
- `limit`: Max results to return (default: 100, max: 1000 for raw logs)
- `scanLimit`: Max logs to fetch before filtering (default: 5000, max: 10000)

## Schema Files

The logging tool uses a dual-file schema system (following the Firestore pattern):

### Manual Schema (Optional)

**File**: `logging-schemas.json` (root directory)

Document your functions and expected labels for team reference:

```json
{
  "functions": {
    "sendEmail": {
      "description": "Sends transactional emails via SendGrid",
      "expectedLabels": {
        "user_id": "Recipient user ID",
        "template_id": "Email template identifier",
        "environment": "Deployment environment (production|staging|dev)"
      }
    },
    "processOrder": {
      "description": "Processes e-commerce orders",
      "expectedLabels": {
        "order_id": "Order identifier",
        "payment_method": "Payment provider (stripe|paypal)",
        "environment": "Deployment environment"
      }
    }
  }
}
```

This file is **optional** but recommended for:
- Team documentation
- Onboarding new developers
- Defining expected label conventions

### Auto-Discovered Schema

**File**: `.firebase-logging-schema.json` (auto-generated, gitignored)

Automatically discovered from actual log queries:

```json
{
  "lastUpdated": "2026-01-13T15:30:00Z",
  "totalQueriesRun": 47,
  "functions": {
    "sendEmail": {
      "lastSeen": "2026-01-13T15:29:45Z",
      "logCount": 1240,
      "labels": ["user_id", "environment", "template_id"]
    }
  },
  "labels": {
    "user_id": {
      "functions": ["sendEmail", "processOrder"],
      "type": "identifier",
      "sampleValues": ["123", "456", "789"]
    },
    "environment": {
      "functions": ["sendEmail", "processOrder"],
      "type": "enum",
      "values": ["production", "staging", "dev"]
    }
  }
}
```

**Updates automatically** after each query with:
- Functions seen in logs
- Labels discovered
- Label types detected (enum, identifier, numeric, text)
- Sample values for each label

**Benefits**:
- Reality check against manual documentation
- Catches undocumented label usage
- No maintenance burden - updates automatically

## Labels: Supercharging Your Logs

Custom labels transform logging from basic error tracking to intelligent observability.

### Why Labels Matter

**Without labels**, you can only filter by:
- Function name
- Severity
- Timestamp
- Text search (slow, imprecise)

**With labels**, you unlock:
- **Multi-tenancy**: Filter by customer, organization, tenant
- **User debugging**: See all logs for a specific user journey
- **Feature flags**: Debug feature rollouts by flag state
- **Business context**: Track orders, payments, workflows
- **Environment isolation**: Separate prod/staging/dev
- **A/B testing**: Compare behavior across experiment variants
- **Regional debugging**: Multi-region deployments

### Adding Labels to Your Functions

**Node.js (Firebase Functions v2)**:
```javascript
import { logger } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";

export const processOrder = onCall(async (request) => {
  // Add labels to this log entry
  logger.info("Processing order", {
    labels: {
      user_id: request.auth.uid,
      order_id: orderId,
      payment_method: "stripe",
      environment: process.env.NODE_ENV,
      feature_flag_express: "enabled"
    }
  });

  // Labels in subsequent logs
  logger.warn("Low inventory", {
    labels: { sku: "ABC123" }
  });
});
```

**Python**:
```python
import json

def process_order(request):
    # Structured logging with labels
    log_entry = {
        "message": "Processing order",
        "severity": "INFO",
        "logging.googleapis.com/labels": {
            "user_id": request.auth.uid,
            "order_id": order_id,
            "environment": "production"
        }
    }
    print(json.dumps(log_entry))
```

### Label-Based Queries

**Filter by single label**:
```json
{
  "where": [{"field": "labels.user_id", "operator": "==", "value": "123"}],
  "fields": ["timestamp", "textPayload", "labels"]
}
```

**Filter by multiple labels**:
```json
{
  "where": [
    {"field": "labels.environment", "operator": "==", "value": "production"},
    {"field": "labels.payment_method", "operator": "==", "value": "stripe"},
    {"field": "severity", "operator": "==", "value": "ERROR"}
  ]
}
```

**Discover what label values exist**:
```json
{"distinct": "labels.environment"}
```

**Error rate by environment**:
```json
{
  "groupBy": ["labels.environment"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "error_count"}],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}],
  "orderBy": [{"field": "error_count", "direction": "desc"}]
}
```

**Error rate by feature flag variant**:
```json
{
  "groupBy": ["labels.feature_flag_checkout"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "errors"}],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}]
}
```

### Common Label Use Cases

| Label | Purpose | Example Values | Query Pattern |
|-------|---------|----------------|---------------|
| `user_id` | User journey debugging | "123", "456" | Track all logs for one user |
| `environment` | Environment isolation | "production", "staging", "dev" | Filter prod-only errors |
| `tenant_id` | Multi-tenant SaaS | "acme-corp", "widgets-inc" | Customer-specific debugging |
| `order_id` | Business entity tracking | "ORD-123" | Full order processing trace |
| `payment_method` | Provider debugging | "stripe", "paypal" | Payment provider issues |
| `feature_flag_*` | Feature rollout tracking | "enabled", "disabled", "v2" | Debug specific variants |
| `region` | Multi-region debugging | "us-central1", "europe-west1" | Regional health checks |
| `experiment_variant` | A/B testing | "control", "variant_a" | Compare error rates |

### Multi-Tenant SaaS Example

**Add tenant context to every log**:
```javascript
// Base labels included in all function logs
const baseLabels = {
  tenant_id: getTenantId(request),
  environment: process.env.ENVIRONMENT,
  region: process.env.REGION
};

export const apiCall = onCall(async (request) => {
  logger.info("API request", {
    labels: { ...baseLabels, endpoint: "/api/users" }
  });

  // Business logic...

  logger.error("Database timeout", {
    labels: { ...baseLabels, query: "SELECT users" }
  });
});
```

**Query patterns**:
```json
// Show errors for specific tenant
{
  "where": [
    {"field": "labels.tenant_id", "operator": "==", "value": "acme-corp"},
    {"field": "severity", "operator": "==", "value": "ERROR"}
  ]
}

// Which tenants have errors?
{
  "groupBy": ["labels.tenant_id"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "errors"}],
  "where": [{"field": "severity", "operator": "==", "value": "ERROR"}],
  "orderBy": [{"field": "errors", "direction": "desc"}]
}

// Compare regions
{
  "groupBy": ["labels.region", "severity"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "count"}]
}
```

### Label Best Practices

1. **Consistent naming**: Use `snake_case` (user_id, not userId)
2. **Keep values bounded**: Prefer enums over free text
   - ✅ `environment: "production"`
   - ❌ `error_message: "full stack trace..."`
3. **Add business context**: user_id, order_id, session_id
4. **Always label environment**: Separate prod/staging/dev logs
5. **Track feature flags**: Debug rollout issues
6. **Don't log PII in labels**: Hash/anonymize sensitive data
7. **Document in logging-schemas.json**: Team reference for expected labels

## Examples Library

### Typical Debugging Workflow

```
1. Discovery: "What functions are failing?"
   → {"groupBy": ["functionName"], "aggregates": [...], "where": [{"field": "severity", "operator": "==", "value": "ERROR"}]}
   Result: sendEmail has 45 errors, processOrder has 2

2. Error Analysis: "What are the common errors in sendEmail?"
   → {"groupBy": ["textPayload"], "aggregates": [...], "where": [{"field": "functionName", ...}]}
   Result: "SMTP timeout" (30 occurrences), "Invalid email" (15 occurrences)

3. Raw Logs: "Show me recent sendEmail SMTP timeout errors"
   → {"where": [{"field": "functionName", ...}, {"field": "textPayload", "operator": "LIKE", "value": "%SMTP timeout%"}]}

4. User Impact: "Which users are affected?"
   → {"distinct": "labels.user_id", "where": [{"field": "textPayload", "operator": "LIKE", "value": "%SMTP timeout%"}]}
```

### Production Incident

```json
// Step 1: What's failing?
{
  "groupBy": ["functionName"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "errors"}],
  "where": [
    {"field": "severity", "operator": "==", "value": "ERROR"},
    {"field": "timestamp", "operator": ">", "value": "2026-01-13T15:00:00Z"}
  ],
  "orderBy": [{"field": "errors", "direction": "desc"}]
}

// Step 2: What's the error pattern?
{
  "groupBy": ["textPayload"],
  "aggregates": [{"field": "*", "operation": "count", "alias": "count"}],
  "where": [
    {"field": "functionName", "operator": "==", "value": "paymentProcessor"},
    {"field": "timestamp", "operator": ">", "value": "2026-01-13T15:00:00Z"}
  ],
  "orderBy": [{"field": "count", "direction": "desc"}],
  "limit": 5
}

// Step 3: Recent error details
{
  "fields": ["timestamp", "textPayload", "labels"],
  "where": [
    {"field": "functionName", "operator": "==", "value": "paymentProcessor"},
    {"field": "severity", "operator": "==", "value": "ERROR"}
  ],
  "orderBy": [{"field": "timestamp", "direction": "desc"}],
  "limit": 20
}
```

### Feature Flag Debugging

```json
// Compare error rates across variants
{
  "groupBy": ["labels.feature_flag_new_checkout"],
  "aggregates": [
    {"field": "*", "operation": "count", "alias": "total_requests"},
    {"field": "timestamp", "operation": "max", "alias": "last_seen"}
  ],
  "where": [{"field": "functionName", "operator": "==", "value": "checkout"}]
}

// Errors in new variant only
{
  "where": [
    {"field": "labels.feature_flag_new_checkout", "operator": "==", "value": "enabled"},
    {"field": "severity", "operator": "==", "value": "ERROR"}
  ],
  "fields": ["timestamp", "textPayload", "labels.user_id"]
}
```

### User Journey Tracking

```json
// All logs for a specific user
{
  "where": [{"field": "labels.user_id", "operator": "==", "value": "user_123"}],
  "orderBy": [{"field": "timestamp", "direction": "asc"}]
}

// Which functions did this user trigger?
{
  "distinct": "functionName",
  "where": [{"field": "labels.user_id", "operator": "==", "value": "user_123"}]
}
```

### Execution Trace

```json
// Follow one function execution
{
  "where": [{"field": "executionId", "operator": "==", "value": "abc123xyz"}],
  "orderBy": [{"field": "timestamp", "direction": "asc"}]
}
```

## Troubleshooting

### Permission Errors

**Error**: `Permission denied` or `403 Forbidden`

**Solution**: Grant `roles/logging.viewAccessor` to the service account:
```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/logging.viewAccessor"
```

See [IAM Setup](#iam-setup) — a Firebase Admin SDK service account has no logging
access at all until you do this.

### No Logs Returned

**Check**:
1. Function name is correct (matched case-insensitively, so `extractReceipt` also
   finds the gen2 Cloud Run service `extractreceipt`)
2. Time range includes recent executions
3. Logs exist in Cloud Logging console
4. Service account has correct project

**Debug query**:
```json
// Start with no filters
{"limit": 10}
```

### Labels Not Appearing

**Check**:
1. Functions deployed recently (labels added in code)
2. Using structured logging format (see Labels section)
3. Label keys match query (case-sensitive)

**Debug**:
```json
// See all labels in recent logs
{"fields": ["timestamp", "functionName", "labels"], "limit": 10}
```

### Quota Exceeded

**Error**: `Quota exceeded: 60 requests per minute`

Cloud Logging allows 60 API requests per minute per project (cannot be increased).

**Solutions**:
- Increase `scanLimit` to fetch more logs per query (default: 5000, max: 10000)
- Use aggregation queries instead of multiple raw queries
- Space out queries if running many in succession

**Note**: Quota is per-request, not per-record. Fetching 5000 logs costs the same as 100 logs.

### Schema File Not Loading

**Check**:
1. File exists in project root: `logging-schemas.json`
2. Valid JSON syntax
3. Server startup logs show `[LoggingSchema] Manual schema loaded`

**Optional**: Schema file is not required, server works in discovery-only mode.

### Cloud Logging Filter Syntax

The tool translates queries to Cloud Logging filter syntax automatically. If you see unexpected results:

**Example translation**:
```json
{"where": [{"field": "functionName", "operator": "==", "value": "sendEmail"}]}
```
↓
```
resource.type="cloud_function" AND resource.labels.function_name="sendEmail"
```

Check `cloudLoggingFilter` in response to see the generated filter.

## Performance & Quotas

### API Quotas

- **60 requests per minute** per project (Cloud Logging limit)
- Quota is per-request, NOT per-record fetched
- Fetching 5000 logs = same quota as fetching 100 logs (both 1 request)

### scanLimit Guidance

| scanLimit | Use Case | Memory Usage |
|-----------|----------|--------------|
| 1000 | Quick checks | ~1-2 MB |
| 5000 | Default (recommended) | ~5-10 MB |
| 10000 | Deep investigation | ~10-20 MB |

### Token Efficiency

Use field projection to reduce token usage:

```json
// Full logs: ~500 tokens per entry
{"limit": 10}

// Projected: ~100 tokens per entry (80% savings)
{"fields": ["timestamp", "severity", "textPayload"], "limit": 10}
```

## Learn More

- [Google Cloud Logging Documentation](https://cloud.google.com/logging/docs)
- [Firebase Functions Logging](https://firebase.google.com/docs/functions/writing-and-viewing-logs)
- [Cloud Logging Query Language](https://cloud.google.com/logging/docs/view/logging-query-language)
- [IAM Roles for Logging](https://cloud.google.com/logging/docs/access-control)
