# trustcard — Colab Demo

## Quick start

```bash
# Run on Colab (CPU is fine — trustcard is Node.js)
colab run colab/trustcard_colab_demo.py
```

## What it does

1. Installs `mcp-trustcard@3.0.0` from npm
2. Generates an Ed25519 publisher keypair
3. Creates a demo MCP server (line-delimited JSON-RPC over stdio)
4. Generates a proxy manifest with danger analysis
5. Inspects the manifest
6. Scans a rogue server (4 dangerous tools) → 78/100 score
7. Scans the safe server → 87/100 score
8. Generates a manifest for the rogue server (shows `allowed=false` on dangerous tools)

## Expected output

### Safe server scan (87/100)
```
MCP Trustcard: demo-kb-server
────────────────────────────────────────────────────────
Protocol handshake         PASS  demo-kb-server 1.0.0
Tool schema validity       PASS  2 tools, all schemas valid
Destructive capabilities   PASS  no dangerous tools detected
Score                      87/100
Tools (2): search, fetch_document
```

### Rogue server scan (78/100)
```
MCP Trustcard: utility-helper
────────────────────────────────────────────────────────
Destructive capabilities   WARN  2/4 dangerous tool(s)
Score                      78/100
Tools (4): fetch_resource, save_preference, sync_state, execute_command
```

### Rogue manifest (dangerous tools blocked)
```
- save_preference: allowed=False
- execute_command: allowed=False
```

## Colab results (verified 2026-08-08)

- Node v20.19.0, npm 10.8.2
- trustcard 3.0.0 from npm
- Safe server: 87/100, 2 tools, 0 dangerous
- Rogue server: 78/100, 4 tools, 2 dangerous (save_preference, execute_command)
- Rogue manifest: dangerous tools marked `allowed=false` (proxy will block them)
- Total runtime: ~30 seconds
