// This is a fix script to implement in CompetitorInsights.tsx

// Replace the state hook for selectedKeywordText to use actual computation instead
// Remove this line:
const [selectedKeywordText, setSelectedKeywordText] = useState<string>('');

// Add this derived state instead:
const selectedKeywordText = keywords?.find(k => k.id === selectedKeywordId)?.keyword || '';

// Replace all occurrences of selectedKeyword with selectedKeywordText in these patterns:

// 1. In the competitor card title:
<CardTitle>Competitors for "{selectedKeywordText}"</CardTitle>

// 2. In the competitor details:
{selectedKeywordText ? (
  <span>Keyword: "{selectedKeywordText}"</span>
) : (
  <span>Direct competitor analysis</span>
)}

// 3. In the overview heading:
<h3 className="text-lg font-medium mb-2">
  {selectedKeywordText 
    ? `Top Keywords & Relevance to "${selectedKeywordText}"`
    : "Top Keywords by Density"}
</h3>

// 4. In the keyword relevance check (multiple places):
const isRelated = selectedKeywordText ? (
  kw.keyword.toLowerCase().includes(selectedKeywordText.toLowerCase()) || 
  selectedKeywordText.toLowerCase().includes(kw.keyword.toLowerCase())
) : false;

// 5. In the relevance badge (in keywords tab):
{isRelated && (
  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground">
    {selectedKeywordText ? `Relevant to "${selectedKeywordText}"` : "Top keyword"}
  </span>
)}

// 6. In the heading sections:
const containsKeyword = selectedKeywordText ? 
  heading.toLowerCase().includes(selectedKeywordText.toLowerCase()) : false;

// 7. In the image alt text section:
const altContainsKeyword = selectedKeywordText && img.alt ? 
  img.alt.toLowerCase().includes(selectedKeywordText.toLowerCase()) : false;

// 8. In the keyword relevance badge for images:
{altContainsKeyword && (
  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary text-primary-foreground">
    {selectedKeywordText ? `Contains "${selectedKeywordText}"` : "Optimized alt text"}
  </span>
)}