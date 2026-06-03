const packageJson = require('./package.json')

const { artifactName: _winArtifactName, ...baseWinConfig } = packageJson.build.win
const artifactVersion = process.env.A8A_APP_VERSION || packageJson.version
const macArtifactName = `\${productName}-Mac-\${arch}-${artifactVersion}.\${ext}`

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
  mac: {
    ...(packageJson.build.mac ?? {}),
    category: 'public.app-category.developer-tools',
    darkModeSupport: true,
    icon: 'build/icon.icns',
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64'],
      },
      {
        target: 'zip',
        arch: ['x64', 'arm64'],
      },
    ],
    artifactName: macArtifactName,
  },
  dmg: {
    ...(packageJson.build.dmg ?? {}),
    artifactName: macArtifactName,
    title: `\${productName} ${artifactVersion}`,
    contents: [
      {
        x: 130,
        y: 220,
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications',
      },
    ],
  },
}

module.exports = config
