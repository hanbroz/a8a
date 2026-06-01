const { writeFileSync } = require('fs')
const { resolve } = require('path')

function pad(value) {
  return String(value).padStart(2, '0')
}

function timestampVersion(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('.')
}

const version = process.argv[2] || process.env.A8A_APP_VERSION || timestampVersion()
if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(version)) {
  throw new Error(`버전은 yyyy.MM.dd.HH.mm 형식이어야 합니다: ${version}`)
}

const repository = process.env.A8A_UPDATE_GITHUB_REPO || process.env.GITHUB_REPOSITORY || ''
if (repository && !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
  throw new Error(`GitHub 저장소는 owner/repo 형식이어야 합니다: ${repository}`)
}

const target = resolve(__dirname, '../src/main/appVersion.ts')
writeFileSync(
  target,
  `export const APP_VERSION = '${version}'\nexport const UPDATE_REPOSITORY = '${repository}'\n`,
  'utf8',
)
console.log(version)
