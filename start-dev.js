import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isWin = process.platform === 'win32'
const npmCmd = isWin ? 'npm.cmd' : 'npm'

console.log('🚀 Memulai Nilai Gizi App Suite...\n')

function runService(name, dir, script, colorPrefix) {
  const child = spawn(npmCmd, ['run', script], {
    cwd: path.join(__dirname, dir),
    stdio: 'pipe',
    shell: true,
  })

  child.stdout.on('data', (data) => {
    process.stdout.write(`[${name}] ${data.toString()}`)
  })

  child.stderr.on('data', (data) => {
    process.stderr.write(`[${name} ERR] ${data.toString()}`)
  })

  child.on('close', (code) => {
    console.log(`[${name}] Process exited with code ${code}`)
  })

  return child
}

// 1. API Server
runService('API', 'api', 'start')

// 2. Admin Panel (port 5173 / default Vite port)
runService('ADMIN-PANEL', 'admin-panel-nilai-gizi', 'dev')

// 3. Tampil Data Publik (Vite auto assigns port 5174 if 5173 is busy)
runService('TAMPIL-PUBLIK', 'tampil-data-nilai-gizi', 'dev')
