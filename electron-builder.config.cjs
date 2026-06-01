const packageJson = require('./package.json')

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
    ...packageJson.build.win,
    icon: 'icon.ico',
  },
}

if (process.env.A8A_APP_VERSION) {
  config.win = {
    ...config.win,
    artifactName: `\${productName}-Setup-${process.env.A8A_APP_VERSION}.\${ext}`,
  }
}

module.exports = config
