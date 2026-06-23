# Batch Processing Documentation

## Overview

Batch processing is used to crawl keywords via the DataForSEO API with rate limiting, retry logic, and progress tracking.

## Batch Lifecycle

### Status Flow

```
queued → running → completed
                  ↓
                failed
```

### Batch Item Status Flow

```
pending → running → completed
                    ↓
                  failed
```

## Batch Creation

1. **API Request**: `POST /api/crawl` with optional `keywordIds` array
2. **Batch Created**: Status set to `queued`, batch ID returned immediately
3. **Background Processing**: `crawlKeywords()` function starts processing
4. **Status Update**: Batch status changes to `running` when processing begins

## Batch Item Creation

- **Bulk Insert**: All batch items are created upfront using bulk insert (chunks of 100)
- **Initial Status**: All items start with status `pending`
- **Performance**: Bulk insert is ~100x faster than individual inserts (0.78s for 90 items vs 30+ seconds)

## Processing Flow

1. **Get Keywords**: Fetch keywords from database (by IDs or all)
2. **Create Batch Items**: Bulk insert all items with `pending` status
3. **Process Keywords**: 
   - Update item status to `running` (sets `startTime`)
   - Call DataForSEO API
   - Store rankings and competitors
   - Update item status to `completed` or `failed`
4. **Rate Limiting**: Configurable delay between requests (`CRAWLER_DELAY_MS`, default 1000ms)
5. **Parallel Processing**: Configurable parallel requests (`PARALLEL_CRAWL_REQUESTS`, default 1)

## Retry Logic

- **Max Retries**: 2 retries per keyword
- **Exponential Backoff**: Delay increases with each retry (delay * 2^retryCount)
- **Failure Handling**: After max retries, item marked as `failed`

## Timeout Detection

### Batch Timeout Rules

1. **10 Minute Rule**: If batch has been running > 10 minutes with no progress, mark as failed
2. **15 Minute Rule**: If batch has been running > 15 minutes with stuck items, mark stuck items as failed
3. **Item Timeout**: Individual items running > 5 minutes are considered stuck

### Progress Detection

- **No `updatedAt` Field**: Currently relies on `startTime` and status changes
- **Stuck Detection**: Checks if items remain in `running` or `pending` state for extended periods
- **Auto-Recovery**: Stuck items are automatically marked as `failed` during status checks

## Batch Completion

### Auto-Completion Logic

The batch is automatically marked as `completed` when:
- All items have status `completed` or `failed`
- No items remain in `pending` or `running` state

### Manual Completion

- **Cancel Endpoint**: `POST /api/crawl/reset` can cancel a running batch
- **Status Update**: Cancelled batches are marked as `failed` or `completed` based on progress

## Status Endpoint

`GET /api/crawl/status` returns:
- Batch ID, status, timestamps
- Statistics: total, completed, failed, pending, running
- Auto-detects and handles stuck batches

## Configuration

### Environment Variables

- `CRAWLER_DELAY_MS`: Delay between API calls (default: 1000ms)
- `PARALLEL_CRAWL_REQUESTS`: Number of parallel requests (default: 1)
- `MAX_KEYWORDS_PER_BATCH`: Maximum keywords per batch (currently unused, processes all)

## Known Limitations

1. **No `updatedAt` Field**: Makes progress detection less precise
2. **No Queue System**: All processing happens synchronously
3. **Rate Limiting**: Relies on delays, not a proper queue
4. **Timeout Detection**: Based on heuristics, not precise progress tracking

## Recommendations

1. **Add `updatedAt` Field**: Track when items are last updated for better progress detection
2. **Implement Queue System**: Use BullMQ or similar for better job management
3. **Progress Webhooks**: Notify frontend of progress updates
4. **Better Timeout Handling**: Use precise timestamps instead of heuristics

