const packageJson = require('./package.json')

const { artifactName: _winArtifactName, ...baseWinConfig } = packageJson.build.win
const artifactVersion = process.env.A8A_APP_VERSION || packageJson.version

const config = {
  ...packageJson.build,
  icon: 'icon',
  extraResources: [
    ...(packageJson.build.extraResources ?? []),
    {
      from: 'build/icon.png',
      to: 'icon.png',
    },
  ],
  win: {
    ...baseWinConfig,
    icon: 'icon.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    ...packageJson.build.nsis,
    artifactName: `\${productName}-Setup-${artifactVersion}.\${ext}`,
  },
  portable: {
    ...(packageJson.build.portable ?? {}),
    artifactName: `\${productName}-Portable-${artifactVersion}.\${ext}`,
  },
}

module.exports = config
