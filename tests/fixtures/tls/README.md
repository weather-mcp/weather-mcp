# Test-only TLS fixture

`localhost.crt` and `localhost.key` are a self-signed certificate and its private key, for the
loopback TLS origin and the `https:` proxy in `tests/integration/http-deadline-proxy.test.ts`.

- **Test-only.** The key protects nothing. The certificate is trusted by nothing except a child
  process the test spawns with `NODE_EXTRA_CA_CERTS` pointing at `localhost.crt`.
- **Not shipped.** `package.json` `files` publishes `dist`, `README.md` and `LICENSE` only.
- **Regenerate at will** (valid for 100 years, `localhost` and `127.0.0.1`):

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 36500 \
  -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
  -keyout tests/fixtures/tls/localhost.key -out tests/fixtures/tls/localhost.crt
```
