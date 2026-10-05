// static/og-default.png (1200x630) 생성기. 사용: node tools/og-default/render.mjs
// 의존: next 의 @vercel/og(satori+resvg), Pretendard Regular/SemiBold TTF/OTF.
// 경로는 환경변수 OG_LIB, FONT_REGULAR, FONT_BOLD 로 바꿀 수 있다.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../../static/og-default.png')
const lib = process.env.OG_LIB ||
  '/home/mont/evejuni/nextra-blog/docs/node_modules/next/dist/compiled/@vercel/og/index.node.js'
const regular = readFileSync(process.env.FONT_REGULAR ||
  '/home/mont/evejuni/temp/atom-oh/oh-my-cloud-skills/plugins/aws-content-plugin/skills/aws-light-fcd/assets/fonts/Pretendard-Regular.ttf')
const bold = readFileSync(process.env.FONT_BOLD ||
  '/home/mont/evejuni/nextra-blog/docs/app/og/Pretendard-SemiBold.otf')
const { ImageResponse } = createRequire(import.meta.url)(lib)

const T = {
  title: "makgol's note",
  sub: '글이 되기 전의 조사와 초안',
  tags: 'Kubernetes · 관측성 · 데이터스토어',
  domain: 'docs.makgol.com',
}
const el = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } })

const tree = el({ width: 1200, height: 630, background: '#0d1119', position: 'relative' }, [
  el({ position: 'absolute', left: 56, top: 56, width: 1090, height: 519, borderRadius: 28, background: '#131925' }),
  el({ position: 'absolute', left: 56, top: 56, width: 12, height: 519, borderRadius: 6, background: '#38bdf8' }),
  el({ position: 'absolute', left: 118, top: 168, fontSize: 88, fontWeight: 600, color: '#f1f5f9', letterSpacing: -1 }, T.title),
  el({ position: 'absolute', left: 120, top: 312, fontSize: 31, fontWeight: 400, color: '#94a3b8' }, T.sub),
  el({ position: 'absolute', left: 120, top: 499, fontSize: 24, fontWeight: 400, color: '#64748b' }, T.tags),
  el({ position: 'absolute', left: 120, top: 534, fontSize: 24, fontWeight: 400, color: '#38bdf8' }, T.domain),
])

const res = new ImageResponse(tree, {
  width: 1200, height: 630,
  fonts: [
    { name: 'Pretendard', data: regular, weight: 400, style: 'normal' },
    { name: 'Pretendard', data: bold, weight: 600, style: 'normal' },
  ],
})
writeFileSync(out, Buffer.from(await res.arrayBuffer()))
console.log('wrote', out)
