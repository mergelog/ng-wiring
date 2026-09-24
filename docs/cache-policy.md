# Cache policy

No analysis result is persisted across invocations. A run may reuse ASTs and
indexes only within the same analysis context and source snapshot. If persistent
caching is introduced, its key must include source content, settings and
dependency versions.
