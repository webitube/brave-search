# TODO

1. Add search request queuing to `brave_web_search` tool
   1. Make `brave_web_search` requests add to a queue of requests.
   2. The queue is processed one-at-a-time
   3. Add a settable, fixed time-delay (in decimal seconds) between requests.
   4. This allows a caller to make requests as quickly as it likes while preventing hitting the RATE_LIMIT exception.