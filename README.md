# Value Investment

A collaborative stock screener and security-research workspace. The complete
application source, environment setup, contribution workflow, Cloudflare
deployment instructions, and architecture documentation are in
[`site/README.md`](site/README.md).

## Quick start

```bash
cd site
cp .dev.vars.example .dev.vars
# Edit .dev.vars privately with the AInvest credentials.
chmod 600 .dev.vars
npm install
npm run cf:typegen
npm run db:migrate:local
npm run dev
```

The `.dev.vars` file is ignored by Git and is the only local secrets file used
by the project. Never commit or publicly share it.
