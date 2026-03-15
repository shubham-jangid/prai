# Review Checklist

## Security
- SQL injection via string concatenation or template literals
- Auth bypass — missing middleware, guards, or permission checks
- Secrets, credentials, or API keys hardcoded or logged
- XSS via unescaped user input in HTML/templates
- Path traversal in file operations
- Insecure deserialization of untrusted data
- CORS misconfiguration exposing sensitive endpoints

## Error Handling
- Bare catch blocks that swallow errors silently
- Missing error propagation — caller never knows something failed
- No retry or backoff for transient failures (network, 503, rate limits)
- Error messages leaking internal details (stack traces, SQL, file paths)
- Async operations with no error handling (unhandled promise rejections)

## Data Safety
- Missing database transactions for multi-step mutations
- Race conditions on shared state (check-then-act without locks)
- Missing input validation — nil, empty, wrong type, overflow
- Data loss on failure — partial writes without rollback
- Unsafe concurrent access to collections or shared resources

## Performance
- N+1 query patterns — loops that make individual DB/API calls
- Missing pagination on list endpoints or large data fetches
- Unbounded data loading — no limit on result sets or file sizes
- Missing caching for expensive computations or repeated external calls
- Synchronous blocking calls in async/event-driven code

## Logic & Correctness
- Off-by-one errors in loops, slicing, or boundary conditions
- Null/undefined not handled — will crash at runtime
- Type coercion bugs — string vs number, truthy/falsy misuse
- Dead code — unreachable branches, unused variables or imports
- Inconsistent state — partial updates that leave data in bad state
