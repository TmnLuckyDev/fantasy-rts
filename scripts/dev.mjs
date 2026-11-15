import { spawn } from 'node:child_process'

const viteArgs = process.argv.slice(2)
const apiPort = process.env.RTS_API_PORT ?? '3000'
const children = [
  spawn(process.execPath, ['--watch', '--experimental-strip-types', 'src/server/index.ts'], {
    stdio: 'inherit', env: { ...process.env, PORT: apiPort }
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', ...viteArgs], {
    stdio: 'inherit', env: { ...process.env, RTS_API_PORT: apiPort }
  })
]
function stop() { for (const child of children) child.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of children) {
  child.once('exit', code => {
    process.exitCode = code ?? 0
    stop()
  })
}
