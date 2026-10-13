import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('dist/capacitor', { recursive: true })
await writeFile('dist/capacitor/index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forgettime</title><style>body{background:#151a20;color:#e6eeee;font:18px system-ui;max-width:32rem;margin:20vh auto;padding:24px}p{line-height:1.6;color:#a7b0b3}</style></head><body><h1>Forgettime</h1><p>This native build needs its app URL configured. Set CAP_REMOTE_APP_URL to your HTTPS deployment, then run pnpm cap:sync and rebuild.</p><p>A network connection is needed to open this version.</p></body></html>`)
