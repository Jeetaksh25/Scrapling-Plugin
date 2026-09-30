# Docker

No Python on the machine? Run the scraper from the published image.

```bash
docker pull pyd4vinci/scrapling
# or
docker pull ghcr.io/d4vinci/scrapling:latest
```

## As an MCP server

Point any agent's config at the container instead of `scrapling-mcp`:

```json
{
  "mcpServers": {
    "scrapling": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "pyd4vinci/scrapling", "mcp"]
    }
  }
}
```

The installer cannot write this form automatically (`--python` covers the interpreter
case, not Docker). Write it by hand, or run the installer and then replace the
`scrapling` entry's `command`/`args` with the pair above.

Add `-e SCRAPLING_EXECUTABLE_PATH=/path/to/chrome` plus a bind mount if you want a custom
browser, and `--network host` is not needed — the server speaks stdio over stdin/stdout.

## As a CLI

```bash
docker run --rm pyd4vinci/scrapling extract get "https://example.com" - --ai-targeted
```

Mount a directory to get the output file on the host:

```bash
docker run --rm -v "$PWD:/out" pyd4vinci/scrapling extract get "https://example.com" /out/page.md --ai-targeted
```

## Streamable HTTP

To serve MCP over HTTP instead of stdio — for a remote host or a shared instance — the
server requires authentication (since Scrapling 0.4.15) and binds to localhost by default:

```bash
docker run -p 8000:8000 \
  -e SCRAPLING_MCP_AUTH_TOKEN="$(openssl rand -hex 32)" \
  pyd4vinci/scrapling mcp --http --host 0.0.0.0
```

Clients then connect by URL:

```json
{
  "mcpServers": {
    "scrapling": {
      "type": "http",
      "url": "http://your-host:8000/mcp",
      "headers": { "Authorization": "Bearer <your-token>" }
    }
  }
}
```

Do not run `--http --no-auth` with `--host 0.0.0.0`: that exposes every tool, which can
fetch any URL from the host, to anyone who can reach the port. Put it behind a
TLS-terminating reverse proxy before exposing it publicly.
