import {dirname, relative, resolve} from 'path'
import type {ConfigEnv, UserConfig} from 'vite'
import {loadEnv, normalizePath} from 'vite'
import {createVitePlugins} from './build/vite'
import {exclude, include} from "./build/vite/optimize"
// 当前执行node命令时文件夹的地址(工作目录)
const root = process.cwd()

// 路径查找
function pathResolve(dir: string) {
    return resolve(root, '.', dir)
}

function getRelativeScssUsePath(filename: string, targetPath: string) {
    const cleanFilename = filename.split('?')[0]
    const relativePath = normalizePath(relative(dirname(cleanFilename), targetPath))
    return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

// https://vitejs.dev/config/
export default ({command, mode}: ConfigEnv): UserConfig => {
    let env = {} as any
    const isBuild = command === 'build'
    if (!isBuild) {
        env = loadEnv((process.argv[3] === '--mode' ? process.argv[4] : process.argv[3]), root)
    } else {
        env = loadEnv(mode, root)
    }
    const variablesScssPath = pathResolve('src/styles/variables.scss')
    return {
        base: env.VITE_BASE_PATH,
        root: root,
        // 服务端渲染
        server: {
            port: env.VITE_PORT, // 端口号
            host: "0.0.0.0",
            open: env.VITE_OPEN === 'true',
            // 本地跨域代理. 目前注释的原因：暂时没有用途，server 端已经支持跨域
            // proxy: {
            //   ['/admin-api']: {
            //     target: env.VITE_BASE_URL,
            //     ws: false,
            //     changeOrigin: true,
            //     rewrite: (path) => path.replace(new RegExp(`^/admin-api`), ''),
            //   },
            // },
        },
        // 项目使用的vite插件。 单独提取到build/vite/plugin中管理
        plugins: createVitePlugins(isBuild, env),
        css: {
            lightningcss: {
                // Preserve legacy star-hack declarations by stripping invalid syntax during minification.
                errorRecovery: true
            },
            preprocessorOptions: {
                scss: {
                    additionalData: (source: string, filename: string) => {
                        const normalizedFilename = normalizePath(filename)
                        // Windows 下更容易触发重复注入：定义或显式转导变量的文件，不能再次注入同一个
                        // `@use ... as *`，否则 Sass 会报 duplicate global variables。
                        if (
                            normalizedFilename.endsWith('/src/styles/variables.scss') ||
                            normalizedFilename.endsWith('/src/styles/global.module.scss')
                        ) {
                            return source
                        }
                        return `@use "${getRelativeScssUsePath(filename, variablesScssPath)}" as *;\n${source}`
                    },
                    api: 'modern-compiler'
                }
            }
        },
        resolve: {
            extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.scss', '.css'],
            alias: [
                {
                    find: /\@\//,
                    replacement: `${pathResolve('src')}/`
                },
                // form-create 运行时已改为工程内源码（src/lib/form-create），不再走 npm 包。
                // 这里保留上游的 `@form-create/*` 写法并转发过去，好处是 vendored 目录
                // 对上游保持零 diff，升级可以直接覆盖。详见 src/lib/form-create/VENDOR.md。
                //
                // ⚠️ 顺序敏感：Rollup 的 alias 对字符串 find 只在 `id === find` 或
                // `id.startsWith(find + '/')` 时命中，所以更长的前缀必须排在前面。
                {
                    find: '@form-create/element-ui/auto-import',
                    replacement: pathResolve('src/lib/form-create/element-ui/auto-import.js')
                },
                {
                    find: '@form-create/element-ui',
                    replacement: pathResolve('src/lib/form-create/element-ui/src/index.js')
                },
                {
                    find: '@form-create/utils/lib',
                    replacement: pathResolve('src/lib/form-create/utils/lib')
                },
                {
                    find: '@form-create/utils',
                    replacement: pathResolve('src/lib/form-create/utils/lib/index.js')
                },
                {
                    find: '@form-create/core',
                    replacement: pathResolve('src/lib/form-create/core')
                },
                // 控件包是 @form-create/component-elm-<name>/src/index 这种带子路径的写法，
                // 字符串 find 在 `component-elm-` 这种半个路径段上匹配不到，只能用正则
                {
                    find: /^@form-create\/component-elm-(.*)/,
                    replacement: `${pathResolve('src/lib/form-create/components/elm-')}$1`
                },
                {
                    find: '@form-create/component-subform',
                    replacement: pathResolve('src/lib/form-create/components/subform')
                }
            ]
        },
        build: {
            chunkSizeWarningLimit: 2000,
            minify: 'oxc',
            outDir: env.VITE_OUT_DIR || 'dist',
            reportCompressedSize: false,
            // 用独立的 .map 文件，不要内联。
            // 内联时 vite 的 build-import-analysis 会走
            // chunk.code.replace(convertSourceMap.mapFileCommentRegex, '')，
            // 而这个正则在本项目这种体量的 chunk 上会回溯到爆栈：
            // RangeError: Maximum call stack size exceeded，构建直接失败。
            // 内联本身也不合适 —— 它把整份 base64 sourcemap 塞进每个 chunk，产物膨胀好几倍。
            sourcemap: env.VITE_SOURCEMAP === 'true',
            rollupOptions: {
                output: {
                    minify: {
                        compress: {
                            dropDebugger: env.VITE_DROP_DEBUGGER === 'true',
                            dropConsole: env.VITE_DROP_CONSOLE === 'true'
                        }
                    },
                    codeSplitting: {
                        groups: [
                            { name: 'echarts', test: /node_modules[\\/]echarts[\\/]/ }, // 将 echarts 单独打包，参考 https://gitee.com/yudaocode/yudao-ui-admin-vue3/issues/IAB1SX 讨论
                            // form-create 运行时已 vendored 到 src/lib，不再在 node_modules 下，
                            // 这条 test 必须跟着改，否则它会散进主 chunk。
                            // 参考 https://github.com/yudaocode/yudao-ui-admin-vue3/issues/148 讨论
                            { name: 'form-create', test: /src[\\/]lib[\\/]form-create[\\/]/ },
                            { name: 'form-designer', test: /node_modules[\\/]@form-create[\\/]designer[\\/]/ },
                            { name: 'monaco-editor', test: /node_modules[\\/]monaco-editor[\\/]/ } // Monaco Editor 单独打包
                        ]
                    }
                },
            },
        },
        optimizeDeps: {include, exclude}
    }
}
