# Crawler Performance Optimization

## 🚀 Speed Improvements

The API crawler has been optimized for significantly faster performance:

### Before Optimization
- **Delay**: 5 seconds between each API request
- **Processing**: Sequential (one keyword at a time)
- **Time for 25 keywords**: ~125 seconds (2+ minutes) + API call time

### After Optimization
- **Delay**: 1 second between requests (configurable)
- **Processing**: Parallel (2 keywords at once by default)
- **Time for 25 keywords**: ~13 seconds + API call time
- **Speed improvement**: ~10x faster! ⚡

## ⚙️ Configuration

The crawler settings are now configurable via environment variables in your `.env` file:

```bash
# Delay between API requests (in milliseconds)
# Default: 1000ms (1 second)
# Previous: 5000ms (5 seconds)
CRAWLER_DELAY_MS=1000

# Number of parallel requests to process simultaneously
# Default: 2
# Previous: 1 (sequential)
# Recommended: 2-3 (depending on your DataForSEO plan)
PARALLEL_CRAWL_REQUESTS=2

# Maximum keywords per batch
# Default: 70
MAX_KEYWORDS_PER_BATCH=70
```

## 📊 Performance Comparison

| Setting | Old | New | Improvement |
|---------|-----|-----|-------------|
| Delay per request | 5 seconds | 1 second | 5x faster |
| Parallel processing | 1 request | 2 requests | 2x faster |
| **Total speed** | **Baseline** | **~10x faster** | **10x** |

### Example: 25 Keywords

- **Old**: 25 keywords × 5 seconds = 125 seconds (2+ minutes)
- **New**: 25 keywords ÷ 2 parallel × 1 second = ~13 seconds
- **Time saved**: ~112 seconds per batch!

## 🎯 Recommended Settings

### For Most Users (Balanced)
```bash
CRAWLER_DELAY_MS=1000
PARALLEL_CRAWL_REQUESTS=2
```
- Good balance of speed and API rate limit compliance
- Works with most DataForSEO plans

### For Faster Processing (If you have a higher-tier plan)
```bash
CRAWLER_DELAY_MS=500
PARALLEL_CRAWL_REQUESTS=3
```
- Even faster, but may hit rate limits on lower-tier plans
- Monitor for API errors and adjust if needed

### For Conservative (If you hit rate limits)
```bash
CRAWLER_DELAY_MS=2000
PARALLEL_CRAWL_REQUESTS=1
```
- Slower but safer
- Use if you experience API rate limit errors

## ⚠️ Important Notes

1. **DataForSEO Rate Limits**: Different plans have different rate limits. If you see rate limit errors, increase `CRAWLER_DELAY_MS` or decrease `PARALLEL_CRAWL_REQUESTS`.

2. **API Plan**: Check your DataForSEO plan limits:
   - **Starter/Basic**: Usually 1-2 requests/second → Use `PARALLEL_CRAWL_REQUESTS=1-2`
   - **Professional/Enterprise**: Often 3-5 requests/second → Use `PARALLEL_CRAWL_REQUESTS=2-3`

3. **Error Handling**: The crawler still has retry logic (2 retries with exponential backoff) if requests fail.

4. **Restart Required**: After changing `.env` settings, restart the server for changes to take effect.

## 🔍 Monitoring

Watch the server logs to see:
- Processing speed: `Processing X keywords in batch Y (2 parallel requests, 1000ms delay)`
- Progress: `Successfully processed keyword: [keyword name]`
- Errors: Any rate limit or API errors will be logged

## 📈 Expected Results

With the optimized settings:
- **25 keywords**: ~15-20 seconds (was 2+ minutes)
- **50 keywords**: ~30-40 seconds (was 4+ minutes)
- **70 keywords**: ~45-60 seconds (was 6+ minutes)

The exact time depends on:
- API response time (varies by keyword complexity)
- Network latency
- Database write speed

Enjoy your much faster crawler! 🎉

