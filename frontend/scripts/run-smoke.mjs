// 冒烟测试启动器：用 esbuild 的 JS API 把 TS 测试打成单文件再交给 node 跑。
// 仓库预置依赖可能来自其他平台，这里按当前平台显式定位 @esbuild 的二进制。
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(new URL('..', import.meta.url).pathname)
const esbuildEntry = join(root, 'node_modules', 'esbuild', 'lib', 'main.js')
if (!existsSync(esbuildEntry)) {
  console.error('未找到 esbuild，请先在 frontend/ 下执行 npm install')
  process.exit(1)
}

// 预置依赖若是别的平台装的，默认会点错二进制；显式指向当前平台包。
const platformBinary = join(
  root,
  'node_modules',
  '@esbuild',
  `${process.platform}-${process.arch}`,
  'bin',
  'esbuild',
)
if (existsSync(platformBinary)) {
  process.env.ESBUILD_BINARY_PATH = platformBinary
}

const esbuild = await import(pathToFileURL(esbuildEntry).href)
const dir = mkdtempSync(join(tmpdir(), 'mortar-smoke-'))
const out = join(dir, 'smoke.mjs')
try {
  await esbuild.build({
    entryPoints: [join(root, 'scripts', 'smoke-mortar.mts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@': join(root, 'src') },
    outfile: out,
    logLevel: 'silent',
  })
  await import(pathToFileURL(out).href)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}
